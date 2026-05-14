@echo off
chcp 65001 >nul
TITLE YiboVibe Debug
cd /d "%~dp0"

set "NODE_EXE="
if not "%NVM_SYMLINK%"=="" set "NODE_EXE=%NVM_SYMLINK%\node.exe"
if "%NODE_EXE%"=="" if exist "D:\Program\nodejs\node.exe" set "NODE_EXE=D:\Program\nodejs\node.exe"
set "TAURI_CLI_JS=%~dp0desktop\node_modules\@tauri-apps\cli\tauri.js"

if not exist "%NODE_EXE%" (
    echo node.exe not found. Checked NVM_SYMLINK and D:\Program\nodejs\node.exe
    pause
    exit /b 1
)

if not exist "%TAURI_CLI_JS%" (
    echo tauri.js not found: %TAURI_CLI_JS%
    pause
    exit /b 1
)

taskkill /F /IM tauri-app.exe /T 2>nul
taskkill /F /IM YiboVibe.exe /T 2>nul

:: Kill any leftover node processes holding port 1420
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :1420 ^| findstr LISTENING') do (
    taskkill /F /PID %%a 2>nul
)

cd /d "%~dp0desktop"
"%NODE_EXE%" "%TAURI_CLI_JS%" dev
pause
