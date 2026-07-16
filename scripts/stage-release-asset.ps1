param(
    [Parameter(Mandatory = $true)]
    [string]$SourceFile,

    [Parameter(Mandatory = $true)]
    [string]$TargetName
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$releaseDir = Join-Path $repoRoot ".release-assets"
$resolvedSource = Resolve-Path $SourceFile

if (-not (Test-Path -LiteralPath $releaseDir)) {
    New-Item -ItemType Directory -Path $releaseDir | Out-Null
}

$targetPath = Join-Path $releaseDir $TargetName
Copy-Item -LiteralPath $resolvedSource -Destination $targetPath -Force

Get-Item -LiteralPath $targetPath | Select-Object FullName, Length, LastWriteTime
