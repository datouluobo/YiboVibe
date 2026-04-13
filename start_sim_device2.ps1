# YiboFlow 多端模拟快捷启动脚本 (Sim-PC-2) 彻底修正版
# 使用说明: 此脚本将彻底绕过端口竞争与单实例限制

$SimName = "Sim-PC-2"
$DataDir = Join-Path $env:LOCALAPPDATA "YiboFlow_Sim_2"

if (-not (Test-Path $DataDir)) {
    New-Item -ItemType Directory -Path $DataDir | Out-Null
    Write-Host "已创建模拟设备数据目录: $DataDir" -ForegroundColor Green
}

Write-Host "----------------------------------------------------"
Write-Host "正在启动 YiboFlow 模拟实例: $SimName" -ForegroundColor Cyan
Write-Host "隔离数据路径: $DataDir"
Write-Host "强制端口重定向: 1421"
Write-Host "单实例锁定绕过标识: com.yiboflow.desktop.sim2"
Write-Host "----------------------------------------------------"

# 1. 设置应用数据隔离
$env:YIBOFLOW_DATA_DIR = $DataDir

# 2. 告诉 Vite 使用 1421 端口 (Vite 官方变量)
$env:PORT = 1421

# 3. 告诉 Tauri 覆盖 tauri.conf.json (Tauri v2 官方变量)
# 修改标识符，骗过 single-instance 插件
$env:TAURI_CONFIG_IDENTIFIER = "com.yiboflow.desktop.sim2"
# 修改前端通信地址，改为 1421 匹配上面的 PORT
$env:TAURI_CONFIG_BUILD_DEV_URL = "http://127.0.0.1:1421"

# 4. 彻底去掉原本末尾的 -- --port 1421 (解决 Cargo 闪退)
Set-Location "f:\Download\GitHub\YiboFlow\desktop"
npx tauri dev
