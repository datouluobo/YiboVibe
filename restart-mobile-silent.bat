@echo off
setlocal EnableExtensions

set "PROJECT_DIR=%~dp0mobile\android"
if not exist "%PROJECT_DIR%" (
  echo [error] Mobile project directory not found: "%PROJECT_DIR%"
  exit /b 1
)

set "DEVICE=%~1"
if "%DEVICE%"=="" set "DEVICE=chrome"
set "WEB_PORT=10333"
set "ADB_EXE=C:\Users\Administrator\AppData\Local\Android\Sdk\platform-tools\adb.exe"
set "APP_ID=com.yibovibe.yibovibe_mobile"

for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "$port=%WEB_PORT%; $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($null -eq $conn) { return }; $proc = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $conn.OwningProcess); if ($null -eq $proc) { return }; $cmd = $proc.CommandLine; if ($cmd -match 'flutter_tools\.snapshot run' -and $cmd -match ('--web-port ' + $port)) { Write-Output $conn.OwningProcess } else { Write-Output ('BLOCKED:' + $conn.OwningProcess + ':' + $proc.Name) }"` ) do set "PORT_OWNER=%%P"

if defined PORT_OWNER (
  echo %PORT_OWNER% | findstr /b "BLOCKED:" >nul
  if not errorlevel 1 (
    echo [error] Web port %WEB_PORT% is already in use by a non-Flutter process: %PORT_OWNER%
    echo [error] Please free port %WEB_PORT% manually or change the script port.
    exit /b 1
  )
  echo [info] Found stale Flutter web runner on port %WEB_PORT%, stopping PID %PORT_OWNER%...
  taskkill /PID %PORT_OWNER% /T /F >nul 2>nul
  timeout /t 1 /nobreak >nul
)

if /i not "%DEVICE%"=="chrome" if exist "%ADB_EXE%" (
  echo [info] Force-stopping %APP_ID% on device %DEVICE% to avoid duplicate Android tasks...
  "%ADB_EXE%" -s "%DEVICE%" shell am force-stop "%APP_ID%" >nul 2>nul
)

set "LAUNCH_VBS=%temp%\yibovibe_restart_mobile_silent.vbs"

echo [info] Starting mobile app silently on device: %DEVICE%
echo [info] Web port: %WEB_PORT%

> "%LAUNCH_VBS%" echo Set WshShell = CreateObject("WScript.Shell")
>>"%LAUNCH_VBS%" echo WshShell.CurrentDirectory = "%PROJECT_DIR%"
>>"%LAUNCH_VBS%" echo WshShell.Run "cmd /c flutter run -d ""%DEVICE%"" --web-port %WEB_PORT%", 0, false

wscript.exe "%LAUNCH_VBS%"
del "%LAUNCH_VBS%" 2>nul

exit /b 0
