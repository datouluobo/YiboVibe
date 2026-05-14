# YiboVibe 多端模拟快捷启动脚本 (Sim-PC-2)
# 使用说明: 此脚本使用独立 Tauri 配置拉起第二实例

$SimName = "Sim-PC-2"
$DataDir = Join-Path $env:LOCALAPPDATA "YiboVibe_Sim_2"
$CargoTargetDir = "F:\Download\GitHub\YiboVibe\target-sim2"
$NodeExe = $null
if ($env:NVM_SYMLINK) {
    $NodeExe = Join-Path $env:NVM_SYMLINK "node.exe"
}
if (-not $NodeExe -and (Test-Path "D:\Program\nodejs\node.exe")) {
    $NodeExe = "D:\Program\nodejs\node.exe"
}
$TauriCliJs = "F:\Download\GitHub\YiboVibe\desktop\node_modules\@tauri-apps\cli\tauri.js"

if (-not $NodeExe) {
    Write-Error "未找到 node.exe。已检查 NVM_SYMLINK 和 D:\Program\nodejs\node.exe"
    exit 1
}

if (-not (Test-Path $TauriCliJs)) {
    Write-Error "未找到 tauri.js: $TauriCliJs"
    exit 1
}

if (-not (Test-Path $DataDir)) {
    New-Item -ItemType Directory -Path $DataDir | Out-Null
    Write-Host "已创建模拟设备数据目录: $DataDir" -ForegroundColor Green
}

if (-not (Test-Path $CargoTargetDir)) {
    New-Item -ItemType Directory -Path $CargoTargetDir | Out-Null
    Write-Host "已创建第二实例编译目录: $CargoTargetDir" -ForegroundColor Green
}

Write-Host "----------------------------------------------------"
Write-Host "正在启动 YiboVibe 模拟实例: $SimName" -ForegroundColor Cyan
Write-Host "隔离数据路径: $DataDir"
Write-Host "隔离编译路径: $CargoTargetDir"
Write-Host "独立 Dev 端口: 1421"
Write-Host "独立应用标识: com.yibovibe.desktop.sim2"
Write-Host "----------------------------------------------------"

# 1. 设置应用数据隔离
$env:YIBOVIBE_DATA_DIR = $DataDir

# 2. 关闭第二实例的单实例防护
$env:YIBOVIBE_ALLOW_MULTI_INSTANCE = "1"

# 3. 给第二实例固定 runtime device tag，避免与主实例共用设备指纹
$env:YIBOVIBE_INSTANCE_TAG = "sim2"

# 4. 让 HMR 也使用独立端口，避免连接回主实例 dev server
$env:TAURI_HMR_PORT = 1421

# 5. 使用独立 Cargo target，避免与主实例争用 target\debug\tauri-app.exe
$env:CARGO_TARGET_DIR = $CargoTargetDir

# 6. 使用第二套 Tauri 配置，显式指定 identifier 和 devUrl
Set-Location "F:\Download\GitHub\YiboVibe\desktop"
& $NodeExe $TauriCliJs dev --config src-tauri/tauri.sim2.conf.json
