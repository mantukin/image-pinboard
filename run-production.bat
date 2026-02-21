@echo off
echo Starting Image Clipboard Manager (Production)
echo.
echo Make sure to run this script WITHOUT administrator privileges!
echo.

cd /d "%~dp0"
start "" "src-tauri\target\release\image-clipboard-manager.exe"
