@echo off
TITLE YiboFlow Dev
cd /d "%~dp0"
taskkill /F /IM tauri-app.exe /T 2>nul
taskkill /F /IM YiboFlow.exe /T 2>nul
cd desktop
if not exist node_modules (call npm install)
call npx tauri dev
pause
