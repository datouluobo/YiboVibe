@echo off
TITLE YiboFlow Dev Shutdown
COLOR 0C

echo =========================================
echo       YiboFlow Dev Environment Stop
echo =========================================
echo.

echo [1/3] Stopping Tauri Desktop Client (Node/Vite processes)...
powershell -Command "Get-Process -Name 'node', 'tauri-app', 'vite' -ErrorAction SilentlyContinue | Stop-Process -Force"

echo [2/3] Stopping Go Backend Server...
powershell -Command "Get-Process -Name 'go', 'main', 'yiboflow' -ErrorAction SilentlyContinue | Stop-Process -Force; $ports = Get-NetTCPConnection -LocalPort 8080,1420 -ErrorAction SilentlyContinue; if ($ports) { $ports | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } }"

echo [3/3] Stopping Postgres and Redis via Docker...
cd /d "%~dp0\server"
docker-compose stop

echo.
echo =========================================
echo Shutdown sequence complete!
echo All local database instances and background processes have been halted.
echo =========================================
timeout /t 5 >nul
