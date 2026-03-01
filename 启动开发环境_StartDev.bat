@echo off
TITLE YiboFlow Dev Launcher
COLOR 0B

echo =========================================
echo       YiboFlow Dev Environment
echo =========================================
echo.
echo 注意：这是开发环境（Dev Environment）。
echo 启动后会保留黑色的控制台窗口，这是为了让您能看到报错日志。
echo 请不要关闭这些窗口！如果关闭，服务也会随之中断。
echo 如需全后台静默运行（无黑窗），请双击根目录的【日常运行_YiboFlow.vbs】
echo =========================================
echo.

echo [1/3] Starting Postgres and Redis via Docker...
cd /d "%~dp0\server"
docker-compose up -d

echo [2/3] Starting Go Backend Server...
start "YiboFlow Backend API" cmd /k "set DB_DSN=host=localhost user=yibo_admin password=secret_password dbname=yiboflow port=5432 sslmode=disable TimeZone=Asia/Shanghai&& set REDIS_URL=redis://:secret_redis_pass@localhost:6379/0&& cd server && go run .\cmd\yiboflow\main.go"

echo [3/3] Starting Tauri Desktop Client...
cd /d "%~dp0\desktop"
start "YiboFlow Desktop Native" cmd /k "npm run tauri dev"

echo.
echo =========================================
echo Launch sequence initiated!
echo You can safely close *this* specific orchestrator window, but keep the two new ones open!
echo =========================================
timeout /t 5 >nul
