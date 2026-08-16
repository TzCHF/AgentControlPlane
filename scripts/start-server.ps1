# Starts the AgentControlPlane server on the configured loopback address.
#
# Relay credentials: this script reads ASTERROUTE_API_KEY from the Windows
# User environment (registry). The key goes into the child process
# environment only; it is never written to the console, logs, or files.
#
# Usage:
#   pwsh -File scripts/start-server.ps1            # detached, prints pid + health
#   pwsh -File scripts/start-server.ps1 -Foreground  # run in this terminal
param(
    [switch]$Foreground
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

$key = [Environment]::GetEnvironmentVariable("ASTERROUTE_API_KEY", "User")
if ([string]::IsNullOrWhiteSpace($key)) {
    Write-Error "ASTERROUTE_API_KEY is not set in the User environment (registry). Set it there first; this script never prints key material."
    exit 2
}
$env:ASTERROUTE_API_KEY = $key

$healthUrl = "http://127.0.0.1:4318/health"

if ($Foreground) {
    Set-Location $root
    node src/server.js
    exit $LASTEXITCODE
}

$proc = Start-Process -FilePath "node" -ArgumentList "src/server.js" -WorkingDirectory $root -WindowStyle Hidden -PassThru
"started pid=$($proc.Id)"

$deadline = (Get-Date).AddSeconds(15)
$healthy = $false
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    try {
        $r = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 2
        if ($r.StatusCode -eq 200) {
            "health=$($r.StatusCode) body=$($r.Content)"
            $healthy = $true
            break
        }
    } catch {
        # keep waiting while the server boots
    }
}
if (-not $healthy) {
    "HEALTH_TIMEOUT pid=$($proc.Id)"
    exit 1
}
