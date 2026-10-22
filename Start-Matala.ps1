$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
$Url = 'http://localhost:3000'
function Fail($Message) {
  Write-Host "`nMatala Review Signals could not start.`n$Message" -ForegroundColor Red
  Read-Host 'Press Enter to close'
  exit 1
}
try {
  $docker = Get-Command docker -ErrorAction SilentlyContinue
  if (-not $docker) { Fail 'Docker Desktop is not installed. Install it from https://www.docker.com/products/docker-desktop/ and restart this launcher.' }
  docker info *> $null
  if ($LASTEXITCODE -ne 0) { Fail 'Docker is installed but not running. Open Docker Desktop, wait until it says it is running, then double-click this launcher again.' }
  if (-not (Test-Path '.env')) {
    $bytes = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    $db = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
    $bytes = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    $session = [Convert]::ToBase64String($bytes)
    $bytes = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    $enc = [Convert]::ToBase64String($bytes)
    $bytes = New-Object byte[] 18; [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    $password = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','A').Replace('/','B')
    @("POSTGRES_PASSWORD=$db", "APP_PASSWORD=$password", "SESSION_SECRET=$session", "KEY_ENCRYPTION_SECRET=$enc") | Set-Content -Encoding ascii '.env'
    Write-Host "First-run workspace password: $password" -ForegroundColor Yellow
    Write-Host 'Save this password somewhere private. It is also stored in the local .env file.'
  }
  Write-Host 'Starting Matala Review Signals. First run may take a few minutes...' -ForegroundColor Cyan
  docker compose up -d --build
  if ($LASTEXITCODE -ne 0) { Fail 'Docker Compose failed. Check Docker Desktop is running and your internet connection works.' }
  Write-Host 'Waiting for the app to become ready...'
  $ready = $false
  for ($i=0; $i -lt 60; $i++) {
    try { $r = Invoke-WebRequest -Uri "$Url/health" -TimeoutSec 2; if ($r.StatusCode -eq 200) { $ready = $true; break } } catch {}
    Start-Sleep -Seconds 2
  }
  if (-not $ready) { docker compose logs --tail 40 app; Fail 'The server did not become ready within two minutes. The logs above may explain why.' }
  Start-Process $Url
  Write-Host 'Matala Review Signals is ready in your browser.' -ForegroundColor Green
  Write-Host 'To stop it, double-click Stop-Matala.ps1. Your database remains saved.'
  Start-Sleep -Seconds 3
} catch { Fail $_.Exception.Message }
