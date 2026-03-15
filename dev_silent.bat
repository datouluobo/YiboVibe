@echo off
TITLE YiboFlow_Launcher
cd /d "%~dp0"

taskkill /F /IM tauri-app.exe /T 2>nul
taskkill /F /IM YiboFlow.exe /T 2>nul

for /f "tokens=5" %%a in ('netstat -ano ^| findstr :1420 ^| findstr LISTENING') do (
    taskkill /F /PID %%a 2>nul
)

:: Create a hidden launcher using VBScript (0 = SW_HIDE = completely invisible window)
echo Set WshShell = CreateObject("WScript.Shell") > "%temp%\yf_launch.vbs"
echo WshShell.Run "cmd /c cd /d %~dp0desktop && npx tauri dev", 0, false >> "%temp%\yf_launch.vbs"
wscript.exe "%temp%\yf_launch.vbs"
del "%temp%\yf_launch.vbs" 2>nul
exit
