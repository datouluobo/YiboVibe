@echo off
TITLE YiboFlow_Launcher
cd /d "%~dp0"

set "NODE_EXE="
if not "%NVM_SYMLINK%"=="" set "NODE_EXE=%NVM_SYMLINK%\node.exe"
if "%NODE_EXE%"=="" if exist "D:\Program\nodejs\node.exe" set "NODE_EXE=D:\Program\nodejs\node.exe"
set "TAURI_CLI_JS=%~dp0desktop\node_modules\@tauri-apps\cli\tauri.js"

if not exist "%NODE_EXE%" (
    echo node.exe not found. Checked NVM_SYMLINK and D:\Program\nodejs\node.exe
    exit /b 1
)

if not exist "%TAURI_CLI_JS%" (
    echo tauri.js not found: %TAURI_CLI_JS%
    exit /b 1
)

taskkill /F /IM tauri-app.exe /T 2>nul
taskkill /F /IM YiboFlow.exe /T 2>nul

for /f "tokens=5" %%a in ('netstat -ano ^| findstr :1420 ^| findstr LISTENING') do (
    taskkill /F /PID %%a 2>nul
)

:: Create a hidden launcher using VBScript (0 = SW_HIDE = completely invisible window)
echo Set WshShell = CreateObject("WScript.Shell") > "%temp%\yf_launch.vbs"
echo WshShell.CurrentDirectory = "%~dp0desktop" >> "%temp%\yf_launch.vbs"
echo WshShell.Run """%NODE_EXE%"" ""%TAURI_CLI_JS%"" dev", 0, false >> "%temp%\yf_launch.vbs"
wscript.exe "%temp%\yf_launch.vbs"
del "%temp%\yf_launch.vbs" 2>nul
exit
