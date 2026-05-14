$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$desktopDir = Join-Path $repoRoot "desktop"

Write-Host "[1/5] Building desktop frontend..." -ForegroundColor Cyan
Push-Location $desktopDir
try {
  npm run build
} finally {
  Pop-Location
}

Write-Host "[2/5] Checking tauri-app..." -ForegroundColor Cyan
Push-Location $repoRoot
try {
  cargo check -p tauri-app

  Write-Host "[3/5] Running cmd console smoke..." -ForegroundColor Cyan
  cargo test -p tauri-app --lib terminal::tests::cmd_session_accepts_input_and_returns_output -- --exact --nocapture

  Write-Host "[4/5] Running pwsh console smoke..." -ForegroundColor Cyan
  cargo test -p tauri-app --lib terminal::tests::pwsh_session_accepts_input_and_returns_output -- --exact --nocapture

  Write-Host "[5/5] Running wsl console smoke..." -ForegroundColor Cyan
  cargo test -p tauri-app --lib terminal::tests::wsl_session_accepts_input_and_returns_output -- --exact --nocapture
} finally {
  Pop-Location
}
