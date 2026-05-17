@echo off
setlocal

cd /d "%~dp0mobile\android" || (
  echo [error] 未找到移动端目录: "%~dp0mobile\android"
  exit /b 1
)

set "DEVICE=%~1"
if "%DEVICE%"=="" set "DEVICE=chrome"

echo [info] 正在启动移动端，目标设备: %DEVICE%
echo [info] 如需指定设备，可使用: restart-mobile.bat ^<deviceId^>

flutter run -d %DEVICE%

