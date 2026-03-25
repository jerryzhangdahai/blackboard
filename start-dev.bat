@echo off
echo Starting development servers...
echo.

echo Starting backend server...
start "Backend Server" powershell -NoExit -Command "cd /d %~dp0 && node server/index.js"

timeout /t 2 /nobreak >nul

echo Starting frontend dev server...
start "Frontend Dev Server" powershell -NoExit -Command "cd /d %~dp0\client && npm run dev -- --host"

echo.
echo Services started!
echo Backend: http://localhost:4000
echo Frontend: http://localhost:5173 (Vite will auto-open browser)
echo Frontend LAN access: Check Network address above for access from other devices
echo.
echo Press any key to exit this window (services will continue running)...
pause >nul
