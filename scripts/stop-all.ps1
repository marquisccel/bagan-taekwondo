# BaganTKD - stops the PostgreSQL container started by start-all.ps1.
# The API/worker/web windows stop when you close them (or Ctrl+C inside each); this script only
# handles the database container, which keeps running in the background otherwise.
#
# Usage (from the repo root, in PowerShell):
#   powershell -ExecutionPolicy Bypass -File scripts/stop-all.ps1

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

Write-Host 'Stopping PostgreSQL...' -ForegroundColor Cyan
docker compose down
Write-Host 'Done. Your data is kept (in the Docker volume) for next time.' -ForegroundColor Green
