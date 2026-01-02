# CallBot Automated Diagnostic & Fix Script
# PowerShell script for Windows

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$logDir = Join-Path $scriptRoot "cursor_health_logs"
if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

$fixReport = @{
    backend = @{
        started = $false
        startLog = ""
        endpoints = @{}
        errors = @()
    }
    frontend = @{
        started = $false
        startLog = ""
        url = "http://localhost:3000"
        tailwindPresent = $false
        stylesheetSize = 0
        errors = @()
    }
    prisma = @{
        generated = $false
        migrateStatus = ""
        dbReachable = $false
    }
    env = @{
        backendKeysPresent = @()
        frontendKeysPresent = @()
        missing = @()
    }
    fixesAttempted = @()
    errors = @()
    notes = ""
}

function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logMessage = "[$timestamp] [$Level] $Message"
    Write-Host $logMessage
    Add-Content -Path "$logDir\diagnostic.log" -Value $logMessage
}

function Backup-File {
    param([string]$FilePath)
    if (Test-Path $FilePath) {
        $backupPath = "$FilePath.bak"
        Copy-Item $FilePath $backupPath -Force
        Write-Log "Backed up $FilePath to $backupPath"
        return $true
    }
    return $false
}

function Test-JsonFile {
    param([string]$FilePath)
    try {
        $content = Get-Content $FilePath -Raw -Encoding UTF8
        $null = $content | ConvertFrom-Json
        return $true
    } catch {
        return $false
    }
}

Write-Log "=== CallBot Diagnostic & Fix Script Started ===" "INFO"

# STEP 0: Pre-check
Write-Log "STEP 0: Pre-check" "INFO"
Write-Host "`n=== STEP 0: Pre-check ===" -ForegroundColor Cyan

$nodeVersion = node -v 2>&1
$npmVersion = npm -v 2>&1
$gitVersion = git --version 2>&1
$osInfo = systeminfo | Select-String "OS Name", "OS Version" | Out-String

Write-Host "Node: $nodeVersion"
Write-Host "npm: $npmVersion"
Write-Host "Git: $gitVersion"
Write-Host "OS: $osInfo"

# STEP 1: Backend
Write-Log "STEP 1: Backend checks" "INFO"
Write-Host "`n=== STEP 1: Backend Checks ===" -ForegroundColor Cyan
Set-Location backend

# 1.1 Env presence
Write-Log "Checking backend environment files" "INFO"
$envFiles = @(".env", ".env.local", ".env.development")
$envFound = @()
foreach ($file in $envFiles) {
    if (Test-Path $file) {
        $envFound += $file
        Write-Log "Found: $file" "INFO"
    }
}

$requiredKeys = @("OPENAI_API_KEY", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "DATABASE_URL")
$keysPresent = @()
$keysMissing = @()

foreach ($file in $envFound) {
    $content = Get-Content $file -ErrorAction SilentlyContinue
    foreach ($key in $requiredKeys) {
        if ($content -match "^$key=") {
            if ($keysPresent -notcontains $key) {
                $keysPresent += $key
            }
        }
    }
}

foreach ($key in $requiredKeys) {
    if ($keysPresent -notcontains $key) {
        $keysMissing += "BACKEND:$key"
    }
}

$fixReport.env.backendKeysPresent = $keysPresent
$fixReport.env.missing = $keysMissing

Write-Host "Backend env keys present: $($keysPresent.Count)/$($requiredKeys.Count)"
Write-Host "Missing: $($keysMissing -join ', ')"

# 1.2 Install dependencies
Write-Log "Installing backend dependencies" "INFO"
try {
    $installOutput = npm ci 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) {
        $installOutput = npm install 2>&1 | Out-String
    }
    Write-Log "Backend dependencies installed" "INFO"
    Add-Content -Path "$logDir\backend_install.log" -Value $installOutput
} catch {
    $fixReport.backend.errors += "Dependency installation failed: $_"
    Write-Log "Dependency installation error: $_" "ERROR"
}

# 1.3 Prisma checks
Write-Log "Checking Prisma setup" "INFO"
if (Test-Path "prisma\schema.prisma") {
    try {
        $generateOutput = npx prisma generate 2>&1 | Out-String
        Add-Content -Path "$logDir\prisma_generate.log" -Value $generateOutput
        $fixReport.prisma.generated = $true
        Write-Log "Prisma client generated" "INFO"
    } catch {
        $fixReport.prisma.generated = $false
        $fixReport.backend.errors += "Prisma generate failed: $_"
        Write-Log "Prisma generate error: $_" "ERROR"
    }

    try {
        $migrateOutput = npx prisma migrate status 2>&1 | Out-String
        Add-Content -Path "$logDir\prisma_migrate_status.log" -Value $migrateOutput
        $fixReport.prisma.migrateStatus = $migrateOutput
        Write-Log "Prisma migrate status checked" "INFO"
    } catch {
        Write-Log "Prisma migrate status error: $_" "WARN"
    }
}

# 1.4 Start backend dev server
Write-Log "Starting backend dev server" "INFO"
$backendProcess = $null
try {
    $packageJson = Get-Content "package.json" | ConvertFrom-Json
    $devScript = $packageJson.scripts.dev
    
    if ($devScript) {
        $backendJob = Start-Job -ScriptBlock {
        Set-Location $using:PWD
        npm run dev 2>&1
    }
    Start-Sleep -Seconds 8
    
    $startLog = Receive-Job $backendJob -ErrorAction SilentlyContinue | Select-Object -First 120
    $startLog | Out-File "$logDir\backend_dev.log" -Encoding UTF8
        $fixReport.backend.startLog = ($startLog -join "`n")
        
        # Check if server is running
        try {
            $healthCheck = Invoke-WebRequest -Uri "http://localhost:4000/health" -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
            $fixReport.backend.started = $true
            Write-Log "Backend server started successfully" "INFO"
        } catch {
            $fixReport.backend.started = $false
            $fixReport.backend.errors += "Backend health check failed: $_"
            Write-Log "Backend health check failed: $_" "WARN"
        }
    }
} catch {
    $fixReport.backend.started = $false
    $fixReport.backend.errors += "Backend start failed: $_"
    Write-Log "Backend start error: $_" "ERROR"
}

# 1.5 Health endpoints
if ($fixReport.backend.started) {
    Write-Log "Testing backend endpoints" "INFO"
    
    # Test /test-db
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:4000/test-db" -UseBasicParsing -TimeoutSec 5
        $body = $response.Content | ConvertFrom-Json
        $fixReport.backend.endpoints["/test-db"] = @{
            status = $response.StatusCode
            ok = $true
            body = $body
        }
        $fixReport.prisma.dbReachable = $true
        Write-Log "GET /test-db: OK" "INFO"
    } catch {
        $fixReport.backend.endpoints["/test-db"] = @{
            status = $null
            ok = $false
            body = $_.Exception.Message
        }
    }
    
    # Test /test-seed
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:4000/test-seed" -UseBasicParsing -TimeoutSec 5
        $body = $response.Content | ConvertFrom-Json
        $fixReport.backend.endpoints["/test-seed"] = @{
            status = $response.StatusCode
            ok = $true
            body = $body
        }
        Write-Log "GET /test-seed: OK" "INFO"
    } catch {
        $fixReport.backend.endpoints["/test-seed"] = @{
            status = $null
            ok = $false
            body = $_.Exception.Message
        }
    }
    
    # Test /debug/score
    try {
        $body = @{
            transcript = "test interest"
            durationSeconds = 60
        } | ConvertTo-Json
        $response = Invoke-WebRequest -Uri "http://localhost:4000/debug/score" -Method POST -Body $body -ContentType "application/json" -UseBasicParsing -TimeoutSec 5
        $responseBody = $response.Content | ConvertFrom-Json
        $fixReport.backend.endpoints["/debug/score"] = @{
            status = $response.StatusCode
            ok = $true
            body = $responseBody
        }
        Write-Log "POST /debug/score: OK" "INFO"
    } catch {
        $fixReport.backend.endpoints["/debug/score"] = @{
            status = $null
            ok = $false
            body = $_.Exception.Message
        }
    }
}

Set-Location ..

# STEP 2: Frontend
Write-Log "STEP 2: Frontend checks" "INFO"
Write-Host "`n=== STEP 2: Frontend Checks ===" -ForegroundColor Cyan
Set-Location callbot-frontend

# 2.1 Env presence
Write-Log "Checking frontend environment files" "INFO"
$frontendEnvFiles = @(".env", ".env.local")
$frontendKeys = @()
foreach ($file in $frontendEnvFiles) {
    if (Test-Path $file) {
        $content = Get-Content $file -ErrorAction SilentlyContinue
        $nextPublicKeys = $content | Where-Object { $_ -match "^NEXT_PUBLIC_" }
        foreach ($line in $nextPublicKeys) {
            $keyName = ($line -split "=")[0].Trim()
            if ($frontendKeys -notcontains $keyName) {
                $frontendKeys += $keyName
            }
        }
    }
}
$fixReport.env.frontendKeysPresent = $frontendKeys
Write-Host "Frontend env keys: $($frontendKeys -join ', ')"

# 2.2 Install dependencies
Write-Log "Installing frontend dependencies" "INFO"
try {
    $installOutput = npm ci 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) {
        $installOutput = npm install 2>&1 | Out-String
    }
    Add-Content -Path "$logDir\frontend_install.log" -Value $installOutput
    Write-Log "Frontend dependencies installed" "INFO"
} catch {
    $fixReport.frontend.errors += "Dependency installation failed: $_"
    Write-Log "Frontend dependency installation error: $_" "ERROR"
}

# 2.3 Repair JSON/BOM issues
Write-Log "Checking package.json for issues" "INFO"
if (Test-Path "package.json") {
    if (-not (Test-JsonFile "package.json")) {
        Write-Log "package.json has invalid JSON, creating backup and fixing" "WARN"
        Backup-File "package.json"
        $packageContent = Get-Content "package.json" -Raw -Encoding UTF8
        $packageObj = $packageContent | ConvertFrom-Json
        $sanitized = @{
            name = $packageObj.name
            version = $packageObj.version
            private = $packageObj.private
            scripts = $packageObj.scripts
            dependencies = $packageObj.dependencies
            devDependencies = $packageObj.devDependencies
        } | ConvertTo-Json -Depth 10
        $utf8NoBom = New-Object System.Text.UTF8Encoding $false
        [System.IO.File]::WriteAllText("$PWD\package.json", $sanitized, $utf8NoBom)
        $fixReport.fixesAttempted += "Fixed package.json BOM/invalid JSON"
        Write-Log "Fixed package.json" "INFO"
    }
}

# Check PostCSS configs
if (Test-Path "postcss.config.mjs") {
    Backup-File "postcss.config.mjs"
    Rename-Item "postcss.config.mjs" "postcss.config.mjs.disabled" -Force
    $fixReport.fixesAttempted += "Disabled postcss.config.mjs"
    Write-Log "Disabled postcss.config.mjs" "INFO"
}

if (-not (Test-Path "postcss.config.js") -or -not (Test-Path "postcss.config.cjs")) {
    if (Test-Path "postcss.config.js") {
        Backup-File "postcss.config.js"
    }
    $postcssConfig = @"
module.exports = {
  plugins: {
    "@tailwindcss/postcss": {},
    "autoprefixer": {}
  }
};
"@
    Set-Content -Path "postcss.config.js" -Value $postcssConfig -Encoding UTF8
    $fixReport.fixesAttempted += "Created/updated postcss.config.js"
    Write-Log "Created postcss.config.js" "INFO"
}

# 2.4 Tailwind & PostCSS packages
Write-Log "Checking Tailwind packages" "INFO"
$packages = npm ls tailwindcss @tailwindcss/postcss postcss autoprefixer --depth=0 2>&1 | Out-String
if ($packages -match "missing|extraneous") {
    Write-Log "Installing missing Tailwind packages" "INFO"
    npm install -D tailwindcss @tailwindcss/postcss postcss autoprefixer 2>&1 | Out-Null
    $fixReport.fixesAttempted += "Installed Tailwind/PostCSS packages"
}

if ((Get-Content "package.json" | ConvertFrom-Json).devDependencies.PSObject.Properties.Name -contains "lightningcss") {
    npm remove lightningcss --save-dev 2>&1 | Out-Null
    $fixReport.fixesAttempted += "Removed lightningcss"
    Write-Log "Removed lightningcss" "INFO"
}

# 2.5 Clean build & start dev
Write-Log "Preparing frontend dev server" "INFO"
$packageJson = Get-Content "package.json" | ConvertFrom-Json
if ($packageJson.scripts.dev -notmatch "webpack") {
    Backup-File "package.json"
    $packageJson.scripts.dev = "next dev --webpack"
    $packageJson | ConvertTo-Json -Depth 10 | Set-Content "package.json" -Encoding UTF8
    $fixReport.fixesAttempted += "Updated dev script to use webpack"
    Write-Log "Updated dev script to use webpack" "INFO"
}

if (Test-Path ".next") {
    Remove-Item ".next" -Recurse -Force
    Write-Log "Cleaned .next directory" "INFO"
}

# Start frontend dev server
Write-Log "Starting frontend dev server" "INFO"
try {
    $frontendJob = Start-Job -ScriptBlock {
        Set-Location $using:PWD
        npm run dev 2>&1
    }
    Start-Sleep -Seconds 12
    
    $startLog = Receive-Job $frontendJob -ErrorAction SilentlyContinue | Select-Object -First 120
    $startLog | Out-File "$logDir\frontend_dev.log" -Encoding UTF8
    $fixReport.frontend.startLog = ($startLog -join "`n")
    
    # Check if server is running
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:3000" -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
        $fixReport.frontend.started = $true
        Write-Log "Frontend server started successfully" "INFO"
    } catch {
        $fixReport.frontend.started = $false
        $fixReport.frontend.errors += "Frontend health check failed: $_"
        Write-Log "Frontend health check failed: $_" "WARN"
    }
} catch {
    $fixReport.frontend.started = $false
    $fixReport.frontend.errors += "Frontend start failed: $_"
    Write-Log "Frontend start error: $_" "ERROR"
}

# 2.6 Browser smoke checks
if ($fixReport.frontend.started) {
    Write-Log "Running frontend smoke checks" "INFO"
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:3000" -UseBasicParsing -TimeoutSec 5
        $html = $response.Content
        
        # Check for H1
        if ($html -match '<h1[^>]*>(.*?)</h1>') {
            $h1Text = $matches[1] -replace '<[^>]+>', ''
            Write-Log "Found H1: $h1Text" "INFO"
        }
        
        # Check for Tailwind classes
        if ($html -match 'bg-white|min-h-screen|text-2xl|bg-gray-50|p-4') {
            $fixReport.frontend.tailwindPresent = $true
            Write-Log "Tailwind classes found in HTML" "INFO"
        }
        
        # Check for CSS files
        $cssMatches = [regex]::Matches($html, 'href="([^"]*\.css[^"]*)"')
        foreach ($match in $cssMatches) {
            $cssUrl = $match.Groups[1].Value
            if ($cssUrl -notmatch "^http") {
                $cssUrl = "http://localhost:3000$cssUrl"
            }
            try {
                $cssResponse = Invoke-WebRequest -Uri $cssUrl -UseBasicParsing -TimeoutSec 3 -ErrorAction SilentlyContinue
                if ($cssResponse.Content.Length -gt 20000) {
                    $fixReport.frontend.stylesheetSize = $cssResponse.Content.Length
                    Write-Log "Found large stylesheet: $($cssResponse.Content.Length) bytes" "INFO"
                }
            } catch {
                # CSS file not found or accessible
            }
        }
    } catch {
        $fixReport.frontend.errors += "Smoke check failed: $_"
        Write-Log "Smoke check error: $_" "WARN"
    }
}

Set-Location ..

# STEP 3: Integration checks
Write-Log "STEP 3: Integration checks" "INFO"
Write-Host "`n=== STEP 3: Integration Checks ===" -ForegroundColor Cyan

if ($fixReport.backend.started) {
    try {
        $body = @{
            campaignContactId = "test-id"
        } | ConvertTo-Json
        $response = Invoke-WebRequest -Uri "http://localhost:4000/call/start/test-id" -Method GET -UseBasicParsing -TimeoutSec 5 -ErrorAction SilentlyContinue
        Write-Log "Integration test: call/start endpoint accessible" "INFO"
    } catch {
        Write-Log "Integration test: call/start endpoint not accessible" "WARN"
    }
}

# STEP 4: Quick fixes
Write-Log "STEP 4: Quick fixes" "INFO"
Write-Host "`n=== STEP 4: Quick Fixes ===" -ForegroundColor Cyan

# Check for PrismaClientInitializationError
if ($fixReport.backend.errors -match "PrismaClientInitializationError") {
    Write-Log "PrismaClient initialization error detected" "WARN"
    $fixReport.notes += "Prisma v7 may require prisma.config.ts. Check backend/src/prisma.ts and ensure PrismaClient is constructed correctly. "
}

# STEP 5: Security recommendations
Write-Log "STEP 5: Security recommendations" "INFO"
Write-Host "`n=== STEP 5: Security Recommendations ===" -ForegroundColor Cyan

$gitignoreBackend = Get-Content "backend\.gitignore" -ErrorAction SilentlyContinue
$gitignoreFrontend = Get-Content "callbot-frontend\.gitignore" -ErrorAction SilentlyContinue

if ($gitignoreBackend -notmatch "\.env" -or $gitignoreFrontend -notmatch "\.env") {
    Write-Log "WARNING: .env files may not be in .gitignore" "WARN"
    $fixReport.notes += "Ensure .env files are in .gitignore. Run: git rm --cached .env && echo '.env' >> .gitignore "
}

# STEP 6: Final report
Write-Log "STEP 6: Generating final report" "INFO"
Write-Host "`n=== FINAL REPORT ===" -ForegroundColor Green

$fixReportJson = $fixReport | ConvertTo-Json -Depth 10
Write-Host "`nfix_report = " -ForegroundColor Yellow
Write-Host $fixReportJson

# Human-readable summary
Write-Host "`n=== HUMAN-READABLE SUMMARY ===" -ForegroundColor Cyan
Write-Host "Backend: $(if ($fixReport.backend.started) { '✅ Running' } else { '❌ Not running' })"
Write-Host "Frontend: $(if ($fixReport.frontend.started) { '✅ Running' } else { '❌ Not running' })"
Write-Host "Prisma: $(if ($fixReport.prisma.generated) { '✅ Generated' } else { '❌ Not generated' }) | DB: $(if ($fixReport.prisma.dbReachable) { '✅ Reachable' } else { '❌ Not reachable' })"
Write-Host "Tailwind: $(if ($fixReport.frontend.tailwindPresent) { '✅ Present' } else { '❌ Not detected' })"

if ($fixReport.errors.Count -gt 0 -or $fixReport.backend.errors.Count -gt 0 -or $fixReport.frontend.errors.Count -gt 0) {
    Write-Host "`n⚠️  Top 3 Actions:" -ForegroundColor Yellow
    $allErrors = $fixReport.errors + $fixReport.backend.errors + $fixReport.frontend.errors
    $allErrors | Select-Object -First 3 | ForEach-Object { Write-Host "  - $_" }
}

Write-Log "=== Diagnostic Complete ===" "INFO"

# Save report to file
$fixReportJson | Out-File "$logDir\fix_report.json" -Encoding UTF8

Write-Host "`nLogs saved to: $logDir" -ForegroundColor Green

