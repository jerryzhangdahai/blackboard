# Start development environment script
# Usage: Run .\start-dev.ps1 in PowerShell

Write-Host "Starting backend server..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot'; node server/index.js"

Start-Sleep -Seconds 2

Write-Host "Starting frontend dev server..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot\client'; npm run dev -- --host"

Write-Host "`nServices started!" -ForegroundColor Yellow
Write-Host "Backend: http://localhost:4000" -ForegroundColor Cyan
Write-Host "Frontend: http://localhost:5173 (Vite will auto-open browser)" -ForegroundColor Cyan
Write-Host "Frontend LAN access: Check Network address above for access from other devices" -ForegroundColor Cyan
Write-Host "`nPress Enter to exit this script (services will continue running)..." -ForegroundColor Gray
Read-Host
