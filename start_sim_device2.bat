@echo off
setlocal

set "SIM_NAME=Sim-PC-2"
set "DATA_DIR=%LOCALAPPDATA%\YiboFlow_Sim_2"
set "CARGO_TARGET_DIR=F:\Download\GitHub\YiboFlow\target-sim2"
set "NODE_EXE="
if not "%NVM_SYMLINK%"=="" set "NODE_EXE=%NVM_SYMLINK%\node.exe"
if "%NODE_EXE%"=="" if exist "D:\Program\nodejs\node.exe" set "NODE_EXE=D:\Program\nodejs\node.exe"
set "TAURI_CLI_JS=F:\Download\GitHub\YiboFlow\desktop\node_modules\@tauri-apps\cli\tauri.js"

if not exist "%NODE_EXE%" (
  echo 未找到 node.exe。已检查 NVM_SYMLINK 和 D:\Program\nodejs\node.exe
  exit /b 1
)

if not exist "%TAURI_CLI_JS%" (
  echo 未找到 tauri.js: %TAURI_CLI_JS%
  exit /b 1
)

if not exist "%DATA_DIR%" (
  mkdir "%DATA_DIR%"
  echo 已创建模拟设备数据目录: %DATA_DIR%
)

if not exist "%CARGO_TARGET_DIR%" (
  mkdir "%CARGO_TARGET_DIR%"
  echo 已创建第二实例编译目录: %CARGO_TARGET_DIR%
)

echo ----------------------------------------------------
echo 正在启动 YiboFlow 模拟实例: %SIM_NAME%
echo 隔离数据路径: %DATA_DIR%
echo 隔离编译路径: %CARGO_TARGET_DIR%
echo 独立 Dev 端口: 1421
echo 独立应用标识: com.yiboflow.desktop.sim2
echo ----------------------------------------------------

set "YIBOFLOW_DATA_DIR=%DATA_DIR%"
set "YIBOFLOW_ALLOW_MULTI_INSTANCE=1"
set "YIBOFLOW_INSTANCE_TAG=sim2"
set "TAURI_HMR_PORT=1421"

cd /d "F:\Download\GitHub\YiboFlow\desktop"
call "%NODE_EXE%" "%TAURI_CLI_JS%" dev --config src-tauri/tauri.sim2.conf.json
