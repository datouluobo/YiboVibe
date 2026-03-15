@echo off
chcp 65001 >nul
TITLE YiboFlow Debug
cd /d "%~dp0"

taskkill /F /IM tauri-app.exe /T 2>nul
taskkill /F /IM YiboFlow.exe /T 2>nul

:: Kill any leftover node processes holding port 1420
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :1420 ^| findstr LISTENING') do (
    taskkill /F /PID %%a 2>nul
)

cd /d "%~dp0desktop"
npx tauri dev
pause
