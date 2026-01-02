# Database Connection Troubleshooting

## Error: P1001 - Can't reach database server

### Common Causes:

1. **Supabase Project is Paused (Most Common)**
   - Free tier Supabase projects auto-pause after 1 week of inactivity
   - Solution: Go to https://supabase.com/dashboard and resume your project

2. **Incorrect DATABASE_URL**
   - Check `.env` file has correct connection string
   - Format: `postgresql://user:password@host:port/database?sslmode=require`

3. **Network/Firewall Issues**
   - Corporate firewall blocking port 5432
   - Solution: Check network settings or use VPN

4. **Connection Pooling Issues**
   - Supabase uses connection pooling
   - Make sure you're using the correct connection string (pooler vs direct)

### Quick Fixes:

1. **Check Supabase Dashboard:**
   ```bash
   # Visit: https://supabase.com/dashboard
   # Find your project and click "Resume" if paused
   ```

2. **Verify DATABASE_URL:**
   ```bash
   # In backend/.env, check:
   DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@db.ovlhdgiidsgozgffjdwc.supabase.co:5432/postgres
   ```

3. **Test Connection:**
   ```bash
   cd backend
   npm run dev
   # Try: GET http://localhost:4000/test-db
   ```

4. **Restart Backend:**
   ```bash
   # Stop current server (Ctrl+C)
   # Rebuild and restart:
   npm run build
   npm run start
   ```

### For Production:
- Consider upgrading Supabase plan to avoid auto-pause
- Use connection pooling URL for better performance
- Set up database connection retry logic

