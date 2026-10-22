$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
docker compose stop
Write-Host 'Matala has stopped. Your saved jobs and leads remain in the local database.'
Read-Host 'Press Enter to close'
