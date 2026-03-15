Write-Host "Starting YiboFlow Dev..."
Stop-Process -Name tauri-app -ErrorAction SilentlyContinue
Stop-Process -Name YiboFlow -ErrorAction SilentlyContinue
Set-Location -Path "\desktop"
if (-not (Test-Path node_modules)) { npm install }
npx tauri dev
