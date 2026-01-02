# run_callbot_health.ps1
# Improved CallBot diagnostic & safe-fix script
# Run from repository root. Creates cursor_health_logs/ and fix_report.json.

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $scriptRoot) { $scriptRoot = Get-Location }
$logDir = Join-Path $scriptRoot "cursor_health_logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }

function Write-Log($msg,$level="INFO"){
  $t = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  $line = "[$t] [$level] $msg"
  Write-Host $line
  Add-Content -Path (Join-Path $logDir "diagnostic.log") -Value $line
}

function Backup-File($path){
  if (Test-Path $path) {
    $bak = "$path.bak"
    Copy-Item $path $bak -Force
    Write-Log "Backed up $path -> $bak"
    return $bak
  }
  return $null
}

# small helper to wait for HTTP
function Wait-ForHttp($url, $timeoutSec=20, $interval=1) {
  $end = (Get-Date).AddSeconds($timeoutSec)
  while ((Get-Date) -lt $end) {
    try {
      $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
      return @{ ok=$true; status=$r.StatusCode; content=$r.Content }
    } catch {
      Start-Sleep -Seconds $interval
    }
  }
  return @{ ok=$false; error="timeout" }
}

# base report object
$report = @{
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

Write-Log "Starting CallBot diagnostic (improved)"

/* STEP 0: report versions */
try {
  $nodeVer = (node -v) 2>&1
  $npmVer  = (npm -v) 2>&1
  $gitVer  = (git --version) 2>&1
  Write-Log "node: $nodeVer | npm: $npmVer | git: $gitVer"
} catch {
  Write-Log "Node/npm/git not found or returned error: $_" "WARN"
}

# -------------------
# STEP 1: Backend
# -------------------
Push-Location (Join-Path $scriptRoot "backend")
Write-Log "STEP 1: Backend checks in: $PWD"

# 1.1 env presence (only checks existence, not values)
$envFiles = @(".env", ".env.local", ".env.development")
$foundEnv = @()
foreach ($f in $envFiles) { if (Test-Path $f) { $foundEnv += $f } }
$required = @("OPENAI_API_KEY","TWILIO_ACCOUNT_SID","TWILIO_AUTH_TOKEN","DATABASE_URL")
$presentKeys = @()
foreach ($f in $foundEnv) {
  $lines = Get-Content $f -ErrorAction SilentlyContinue
  foreach ($k in $required) { if ($lines -match "^$k=") { if ($presentKeys -notcontains $k) { $presentKeys += $k } } }
}
$missing = @()
foreach ($k in $required) { if ($presentKeys -notcontains $k) { $missing += "BACKEND:$k" } }
$report.env.backendKeysPresent = $presentKeys
$report.env.missing = $missing

Write-Log "Backend env keys present: $($presentKeys -join ', ')"

# 1.2 install deps (use npm ci first if lockfile present)
try {
  if (Test-Path "package-lock.json") {
    Write-Log "Running npm ci (backend)"
    npm ci 2>&1 | Tee-Object -FilePath (Join-Path $logDir "backend_install.log")
  } else {
    Write-Log "Running npm install (backend)"
    npm install 2>&1 | Tee-Object -FilePath (Join-Path $logDir "backend_install.log")
  }
} catch {
  Write-Log "Backend npm install error: $_" "ERROR"
  $report.backend.errors += "npm install failed"
}

# 1.3 prisma
if (Test-Path "prisma\schema.prisma") {
  try {
    Write-Log "Running npx prisma generate"
    npx prisma generate 2>&1 | Tee-Object -FilePath (Join-Path $logDir "prisma_generate.log")
    $report.prisma.generated = $true
  } catch {
    Write-Log "prisma generate failed: $_" "WARN"
    $report.prisma.generated = $false
    $report.backend.errors += "prisma generate failed"
  }
  try {
    npx prisma migrate status 2>&1 | Tee-Object -FilePath (Join-Path $logDir "prisma_migrate_status.log")
    $report.prisma.migrateStatus = Get-Content (Join-Path $logDir "prisma_migrate_status.log" -ErrorAction SilentlyContinue) -Raw
  } catch {
    Write-Log "prisma migrate status problem: $_" "WARN"
  }
}

# 1.4 Start backend dev server (Start-Process -> log file)
$backendLog = Join-Path $logDir "backend_dev.stdout.log"
try {
  if (Test-Path "package.json") {
    $pkg = Get-Content package.json | ConvertFrom-Json
    if ($pkg.scripts.dev) {
      Write-Log "Starting backend via npm run dev (logging to $backendLog)"
      # ensure log file exists
      if (Test-Path $backendLog) { Remove-Item $backendLog -Force }
      $psi = New-Object System.Diagnostics.ProcessStartInfo
      $psi.FileName = "npm"
      $psi.Arguments = "run dev"
      $psi.WorkingDirectory = (Get-Location).Path
      $psi.RedirectStandardOutput = $true
      $psi.RedirectStandardError = $true
      $psi.UseShellExecute = $false
      $proc = New-Object System.Diagnostics.Process
      $proc.StartInfo = $psi
      $proc.Start() | Out-Null
      # async read to file
      $stdOut = $proc.StandardOutput
      $stdErr = $proc.StandardError
      Start-Job -ScriptBlock {
        param($o,$e,$path)
        while (-not $o.EndOfStream) { $line = $o.ReadLine(); Add-Content -Path $path -Value $line }
        while (-not $e.EndOfStream) { $line = $e.ReadLine(); Add-Content -Path $path -Value $line }
      } -ArgumentList $stdOut,$stdErr,$backendLog | Out-Null

      # wait for http readiness using /test-db or /test-seed
      $waitResult = Wait-ForHttp "http://localhost:4000/test-db" 18
      if (-not $waitResult.ok) { $waitResult = Wait-ForHttp "http://localhost:4000/test-seed" 18 }
      if ($waitResult.ok) {
        $report.backend.started = $true
        $report.backend.startLog = (Get-Content $backendLog -ErrorAction SilentlyContinue -Raw)
        Write-Log "Backend reported up (probe succeeded)" "INFO"
        $report.prisma.dbReachable = $true
      } else {
        $report.backend.started = $false
        $report.backend.startLog = (Get-Content $backendLog -ErrorAction SilentlyContinue -Raw)
        Write-Log "Backend did not respond to probes within timeout" "WARN"
      }
    } else {
      Write-Log "No dev script found in backend package.json" "WARN"
    }
  } else {
    Write-Log "No package.json found in backend" "WARN"
  }
} catch {
  Write-Log "Exception starting backend: $_" "ERROR"
  $report.backend.errors += $_.Exception.Message
}

# 1.5 health endpoints if started
if ($report.backend.started) {
  try {
    $r = Invoke-WebRequest -Uri "http://localhost:4000/test-db" -UseBasicParsing -TimeoutSec 5
    $j = $r.Content | ConvertFrom-Json
    $report.backend.endpoints["/test-db"] = @{ status = $r.StatusCode; ok = $true; body = $j }
  } catch { $report.backend.endpoints["/test-db"] = @{ ok=$false; err = $_.Exception.Message } }

  try {
    $r = Invoke-WebRequest -Uri "http://localhost:4000/test-seed" -UseBasicParsing -TimeoutSec 5
    $j = $r.Content | ConvertFrom-Json
    $report.backend.endpoints["/test-seed"] = @{ status = $r.StatusCode; ok = $true; body = $j }
  } catch { $report.backend.endpoints["/test-seed"] = @{ ok=$false; err = $_.Exception.Message } }

  try {
    $payload = @{ transcript="testing interest"; durationSeconds=60 } | ConvertTo-Json
    $r = Invoke-WebRequest -Uri "http://localhost:4000/debug/score" -Method POST -Body $payload -ContentType "application/json" -UseBasicParsing -TimeoutSec 7
    $report.backend.endpoints["/debug/score"] = @{ status = $r.StatusCode; ok = $true; body = ($r.Content | ConvertFrom-Json) }
  } catch { $report.backend.endpoints["/debug/score"] = @{ ok=$false; err = $_.Exception.Message } }
}

Pop-Location

# -------------------
# STEP 2: Frontend
# -------------------
Push-Location (Join-Path $scriptRoot "callbot-frontend")
Write-Log "STEP 2: Frontend checks in: $PWD"

# 2.1 frontend env NEXT_PUBLIC_*
$frontEnvFiles = @(".env", ".env.local")
$frontKeys = @()
foreach ($f in $frontEnvFiles) {
  if (Test-Path $f) {
    $lines = Get-Content $f -ErrorAction SilentlyContinue
    foreach ($line in $lines) {
      if ($line -match "^NEXT_PUBLIC_") {
        $frontKeys += (($line -split "=")[0].Trim())
      }
    }
  }
}
$report.env.frontendKeysPresent = $frontKeys
Write-Log "Frontend env keys found: $($frontKeys -join ', ')"

# 2.2 install deps
try {
  if (Test-Path "package-lock.json") { npm ci 2>&1 | Tee-Object -FilePath (Join-Path $logDir "frontend_install.log") } else { npm install 2>&1 | Tee-Object -FilePath (Join-Path $logDir "frontend_install.log") }
  Write-Log "Frontend installed"
} catch {
  Write-Log "Frontend install error: $_" "WARN"
  $report.frontend.errors += "npm install failed"
}

# 2.3 repair package/postcss if needed
if (-not (Test-Path "package.json")) {
  Write-Log "No package.json in frontend" "WARN"
} else {
  try {
    $jsonOk = $true
    $pc = Get-Content "package.json" -Raw -Encoding UTF8
    try { $null = $pc | ConvertFrom-Json } catch { $jsonOk = $false }
    if (-not $jsonOk) {
      Backup-File "package.json"
      $pkgobj = $pc | ConvertFrom-Json
      $sanitized = @{
        name = $pkgobj.name
        version = $pkgobj.version
        private = $pkgobj.private
        scripts = $pkgobj.scripts
        dependencies = $pkgobj.dependencies
        devDependencies = $pkgobj.devDependencies
      } | ConvertTo-Json -Depth 10
      [System.IO.File]::WriteAllText("$PWD\package.json",$sanitized, (New-Object System.Text.UTF8Encoding $false))
      $report.fixesAttempted += "Sanitized package.json"
      Write-Log "Sanitized package.json"
    }
  } catch {
    Write-Log "Error validating package.json: $_" "WARN"
  }
}

# postcss config handling
if (Test-Path "postcss.config.mjs") { Backup-File "postcss.config.mjs"; Rename-Item "postcss.config.mjs" "postcss.config.mjs.disabled" -Force; $report.fixesAttempted += "Disabled postcss.config.mjs"; Write-Log "Disabled postcss.config.mjs" }
if (-not (Test-Path "postcss.config.cjs") -and -not (Test-Path "postcss.config.js")) {
  $cfg = 'module.exports = { plugins: { "@tailwindcss/postcss": {}, "autoprefixer": {} } };'
  Set-Content -Path "postcss.config.cjs" -Value $cfg -Encoding UTF8
  $report.fixesAttempted += "Wrote postcss.config.cjs"
  Write-Log "Wrote postcss.config.cjs"
}

# 2.4 ensure packages present (tailwind/adapters/postcss/autoprefixer)
$checkPkgs = npm ls tailwindcss @tailwindcss/postcss postcss autoprefixer --depth=0 2>&1 | Out-String
if ($checkPkgs -match "missing") {
  Write-Log "Installing missing Tailwind/PostCSS deps"
  npm install -D tailwindcss @tailwindcss/postcss postcss autoprefixer 2>&1 | Tee-Object -FilePath (Join-Path $logDir "frontend_tailwind_install.log")
  $report.fixesAttempted += "Installed Tailwind/PostCSS deps"
}

# remove lightningcss if present
try {
  $pkgJson = Get-Content package.json | ConvertFrom-Json
  if ($pkgJson.devDependencies.PSObject.Properties.Name -contains "lightningcss") {
    Write-Log "Removing lightningcss"
    npm remove lightningcss --save-dev 2>&1 | Out-Null
    $report.fixesAttempted += "Removed lightningcss"
  }
} catch {}

# 2.5 ensure dev script uses webpack (backup package.json)
try {
  $pkg = Get-Content package.json | ConvertFrom-Json
  if ($pkg.scripts.dev -notmatch "webpack") {
    Backup-File "package.json"
    $pkg.scripts.dev = "next dev --webpack"
    $pkg | ConvertTo-Json -Depth 10 | Set-Content "package.json" -Encoding UTF8
    $report.fixesAttempted += "Set dev script to next dev --webpack"
    Write-Log "Set dev script to next dev --webpack"
  }
} catch { Write-Log "Could not update package.json dev script: $_" "WARN" }

# clear .next
if (Test-Path ".next") { Remove-Item ".next" -Recurse -Force -ErrorAction SilentlyContinue; Write-Log "Removed .next" }

# start frontend process (Start-Process to log)
$frontendLog = Join-Path $logDir "frontend_dev.stdout.log"
try {
  if (Test-Path "package.json") {
    Write-Log "Starting frontend dev (npm run dev) -> $frontendLog"
    if (Test-Path $frontendLog) { Remove-Item $frontendLog -Force }
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "npm"
    $psi.Arguments = "run dev"
    $psi.WorkingDirectory = (Get-Location).Path
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    $proc2 = New-Object System.Diagnostics.Process
    $proc2.StartInfo = $psi
    $proc2.Start() | Out-Null
    $stdOut2 = $proc2.StandardOutput
    $stdErr2 = $proc2.StandardError
    Start-Job -ScriptBlock {
      param($o,$e,$path)
      while (-not $o.EndOfStream) { $line = $o.ReadLine(); Add-Content -Path $path -Value $line }
      while (-not $e.EndOfStream) { $line = $e.ReadLine(); Add-Content -Path $path -Value $line }
    } -ArgumentList $stdOut2,$stdErr2,$frontendLog | Out-Null

    # wait for main page to respond
    $waitHtml = Wait-ForHttp "http://localhost:3000" 25
    if ($waitHtml.ok) {
      $report.frontend.started = $true
      $report.frontend.startLog = (Get-Content $frontendLog -ErrorAction SilentlyContinue -Raw)
      Write-Log "Frontend reachable"
    } else {
      $report.frontend.started = $false
      $report.frontend.startLog = (Get-Content $frontendLog -ErrorAction SilentlyContinue -Raw)
      Write-Log "Frontend not reachable within timeout" "WARN"
    }
  }
} catch {
  Write-Log "Exception starting frontend: $_" "ERROR"
  $report.frontend.errors += $_.Exception.Message
}

# 2.6 smoke-check html for tailwind classes and H1
if ($report.frontend.started) {
  try {
    $r = Invoke-WebRequest -Uri "http://localhost:3000" -UseBasicParsing -TimeoutSec 5
    $html = $r.Content
    if ($html -match '<h1[^>]*>(.*?)</h1>') { $report.frontend.sampleH1 = ($matches[1] -replace '<[^>]+>','') }
    if ($html -match 'bg-white|min-h-screen|text-2xl|bg-gray-50|p-4') { $report.frontend.tailwindPresent = $true }
    # attempt to find css chunk links and measure size
    $matches = [regex]::Matches($html,'href="([^"]*\.css[^"]*)"')
    foreach ($m in $matches) {
      $u = $m.Groups[1].Value
      if ($u -notmatch '^http') { $u = "http://localhost:3000$u" }
      try {
        $c = Invoke-WebRequest -Uri $u -UseBasicParsing -TimeoutSec 4
        if ($c.Content.Length -gt $report.frontend.stylesheetSize) { $report.frontend.stylesheetSize = $c.Content.Length }
      } catch {}
    }
  } catch {
    Write-Log "Smoke-check error: $_" "WARN"
  }
}

Pop-Location

# -------------------
# STEP 3: Integration checks
# -------------------
Write-Log "STEP 3: Integration quick tests"
if ($report.backend.started -and $report.frontend.started) {
  try {
    $callRes = Invoke-WebRequest -Uri "http://localhost:4000/call/start/test-id" -UseBasicParsing -TimeoutSec 5 -ErrorAction SilentlyContinue
    if ($callRes) { $report.backend.endpoints["/call/start/test-id"] = @{ ok=$true; status=$callRes.StatusCode } }
  } catch { $report.backend.endpoints["/call/start/test-id"] = @{ ok=$false; err=$_.Exception.Message } }
}

# -------------------
# FINALIZE & SAVE
# -------------------
Write-Log "Saving final report to $logDir\fix_report.json"
$reportJson = $report | ConvertTo-Json -Depth 10
$reportJson | Out-File (Join-Path $logDir "fix_report.json") -Encoding UTF8

Write-Host "`n=== HEALTH REPORT ===`n"
Write-Host $reportJson

Write-Log "Diagnostic finished"
Write-Host "`nLogs and artifacts in: $logDir`n"
