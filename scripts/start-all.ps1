# BaganTKD - one-command local launcher.
#
# Starts PostgreSQL (Docker), builds the API/worker, applies database migrations, then opens the
# API, the worker, and the web app each in their own clearly-titled window. Run this once, wait a
# few seconds, then open the web app URL it prints.
#
# Usage (from the repo root, in PowerShell):
#   powershell -ExecutionPolicy Bypass -File scripts/start-all.ps1
#
# Requirements: Docker Desktop running, Node.js installed. Nothing else to configure by hand.

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

$DbUrl = 'postgres://bagantkd:bagantkd_dev_only@127.0.0.1:5433/bagantkd'
$WebPort = 3001

Write-Host ''
Write-Host '=== BaganTKD local launcher ===' -ForegroundColor Cyan
Write-Host ''

Write-Host '[1/5] Starting PostgreSQL (Docker)...' -ForegroundColor Cyan
docker compose up -d postgres
if ($LASTEXITCODE -ne 0) {
  Write-Host 'Could not start Docker/PostgreSQL. Is Docker Desktop running?' -ForegroundColor Red
  exit 1
}

Write-Host '[2/5] Waiting for PostgreSQL to be ready...' -ForegroundColor Cyan
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
  $cid = docker compose ps -q postgres
  if ($cid) {
    $status = docker inspect --format='{{.State.Health.Status}}' $cid 2>$null
    if ($status -eq 'healthy') { $ready = $true; break }
  }
  Start-Sleep -Seconds 2
}
if (-not $ready) {
  Write-Host 'PostgreSQL did not become healthy within 60 seconds.' -ForegroundColor Red
  Write-Host "Check what happened with: docker compose logs postgres" -ForegroundColor Yellow
  exit 1
}
Write-Host '      PostgreSQL is ready.' -ForegroundColor Green

if (-not (Test-Path (Join-Path $RepoRoot 'node_modules'))) {
  Write-Host '[3/5] First run: installing dependencies (this can take a few minutes)...' -ForegroundColor Cyan
  & npx -y pnpm@10.34.5 install
  if ($LASTEXITCODE -ne 0) { Write-Host 'pnpm install failed.' -ForegroundColor Red; exit 1 }
} else {
  Write-Host '[3/5] Dependencies already installed, skipping.' -ForegroundColor Cyan
}

Write-Host '[3/5] Building the API and worker...' -ForegroundColor Cyan
& npx -y pnpm@10.34.5 build
if ($LASTEXITCODE -ne 0) { Write-Host 'Build failed -- see the error above.' -ForegroundColor Red; exit 1 }

Write-Host '[4/5] Applying database migrations...' -ForegroundColor Cyan
$env:DATABASE_URL = $DbUrl
& npx -y pnpm@10.34.5 --filter @bagantkd/db migrate
if ($LASTEXITCODE -ne 0) { Write-Host 'Migration failed -- see the error above.' -ForegroundColor Red; exit 1 }

Write-Host '[5/5] Opening API, worker, and web in their own windows...' -ForegroundColor Cyan

Start-Process powershell -ArgumentList @(
  '-NoExit', '-Command',
  "`$Host.UI.RawUI.WindowTitle = 'BaganTKD - API (http://127.0.0.1:3000)'; Set-Location '$RepoRoot'; `$env:DATABASE_URL = '$DbUrl'; node apps/api/dist/main.js"
) | Out-Null

Start-Process powershell -ArgumentList @(
  '-NoExit', '-Command',
  "`$Host.UI.RawUI.WindowTitle = 'BaganTKD - Worker (draws/PDF/XLSX)'; Set-Location '$RepoRoot'; `$env:DATABASE_URL = '$DbUrl'; node apps/worker/dist/main.js"
) | Out-Null

Start-Process powershell -ArgumentList @(
  '-NoExit', '-Command',
  "`$Host.UI.RawUI.WindowTitle = 'BaganTKD - Web (http://localhost:$WebPort)'; Set-Location '$RepoRoot\apps\web'; npx -y next dev -p $WebPort"
) | Out-Null

Write-Host ''
Write-Host 'Three windows just opened: API, Worker, Web.' -ForegroundColor Green
Write-Host "Wait about 10-15 seconds for them to finish starting, then open:" -ForegroundColor Green
Write-Host "  http://localhost:$WebPort" -ForegroundColor Green
Write-Host ''
Write-Host 'To stop everything: close those 3 windows, then (optional) run scripts/stop-all.ps1' -ForegroundColor Yellow
Write-Host 'to also stop the database container.'
Write-Host ''
