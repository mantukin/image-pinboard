@echo off
echo Starting Tauri Dev Server (without admin privileges)...
echo.
echo Make sure to run this script WITHOUT administrator privileges!
echo.

cd /d "%~dp0"
npm run tauri dev

pause
