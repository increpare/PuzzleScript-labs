[CmdletBinding()]
param(
    [string]$Source = (Split-Path -Parent $PSScriptRoot),
    [ValidateRange(1024, 65535)][int]$Port = 8080,
    [string]$Python,
    [switch]$Build,
    [switch]$Install,
    [switch]$Stop
)

$ErrorActionPreference = 'Stop'
$stateDir = Join-Path $PSScriptRoot '..\.codex_tmp\ps-mis-web'
New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
$stateFile = Join-Path $stateDir "server-$Port.json"
$url = "http://localhost:$Port/mis.html"

if (Test-Path -LiteralPath $stateFile) {
    $saved = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
    $process = Get-Process -Id $saved.processId -ErrorAction SilentlyContinue
    if ($process -and $process.Path -eq $saved.executable -and
        $process.StartTime.ToUniversalTime().Ticks -eq [long]$saved.createdTicks) {
        if ($Stop) {
            Stop-Process -Id $saved.processId
            Remove-Item -LiteralPath $stateFile
            Write-Host "Stopped PS+MIS on port $Port."
            return
        }
        if ($Build) { throw 'Stop the running server before rebuilding: use -Stop, then -Build.' }
        Write-Host "PS+MIS is already running: $url"
        return
    }
    Remove-Item -LiteralPath $stateFile
}
if ($Stop) { Write-Host "No managed PS+MIS server on port $Port."; return }

$Source = (Resolve-Path -LiteralPath $Source).Path
if (!(Test-Path -LiteralPath (Join-Path $Source 'src\mis.html'))) {
    throw "Not a PS+MIS checkout: $Source"
}
Push-Location -LiteralPath $Source
try {
    if ($Install) {
        & npm.cmd ci --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    }
    if ($Build) {
        & node compile.js
        if ($LASTEXITCODE -ne 0) { throw 'Release build failed; server was not started.' }
        & node verify-release-compression.js
        if ($LASTEXITCODE -ne 0) { throw 'Release verification failed; server was not started.' }
    }
} finally { Pop-Location }

$root = Join-Path $Source 'bin'
if (!(Test-Path -LiteralPath (Join-Path $root 'mis.html'))) {
    throw 'No release found. Run this script with -Build (and -Install on first setup).'
}
if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) {
    throw "Port $Port is occupied. Choose another with -Port."
}
if (!$Python) {
    $Python = Get-Command python.exe -All -ErrorAction SilentlyContinue |
        Where-Object Source -NotLike '*\Microsoft\WindowsApps\*' |
        Select-Object -First 1 -ExpandProperty Source
}
if (!$Python) { throw 'Python is missing. Install Python or pass -Python C:\path\to\python.exe.' }
# Virtual-environment launchers may spawn a child and exit. Track the actual
# interpreter so the saved process identity also works for Stop and reuse.
$interpreter = & $Python -c 'import sys; print(getattr(sys, "_base_executable", sys.executable))'
if ($LASTEXITCODE -ne 0) { throw 'Python could not start.' }
$Python = [string]$interpreter
$server = Start-Process -FilePath $Python -ArgumentList @(
    '-u', "`"$(Join-Path $PSScriptRoot 'ps-mis-server.py')`"", '--port', "$Port", '--directory', "`"$root`""
) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $stateDir "server-$Port.log") -RedirectStandardError (Join-Path $stateDir "server-$Port.error.log")
@{ processId = $server.Id; root = $root; executable = $server.Path; createdTicks = $server.StartTime.ToUniversalTime().Ticks.ToString() } |
    ConvertTo-Json | Set-Content -LiteralPath $stateFile
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/mis.html" -UseBasicParsing -TimeoutSec 2
        if ($response.StatusCode -eq 200) { Write-Host "PS+MIS is running: $url"; return }
    } catch { Start-Sleep -Milliseconds 200 }
}
throw "Server did not become ready. Check $stateDir."
