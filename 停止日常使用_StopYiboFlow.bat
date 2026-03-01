@echo off
TITLE YiboFlow Production Shutdown
COLOR 0C

echo =========================================
echo       YiboFlow App Full Shutdown
echo =========================================
echo.

echo [1/3] Stopping Tauri Executable...
powershell -Command "Get-Process -Name 'YiboFlow Desktop', 'tauri-app' -ErrorAction SilentlyContinue | Stop-Process -Force"

echo [2/3] Stopping Go Backend Server Executable...
powershell -Command "Get-Process -Name 'yiboflow_server' -ErrorAction SilentlyContinue | Stop-Process -Force; $ports = Get-NetTCPConnection -LocalPort 8080 -ErrorAction SilentlyContinue; if ($ports) { $ports | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } }"

echo [3/3] Stopping Postgres and Redis via Docker...
cd /d "%~dp0\server"
docker-compose stop

echo.
echo =========================================
echo Shutdown sequence complete!
echo All standalone background programs and databases halted safely.
echo =========================================
timeout /t 5 >nul
