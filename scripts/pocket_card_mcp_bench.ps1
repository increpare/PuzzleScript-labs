param(
    [string]$Port = $env:POCKET_CARD_PORT,
    [switch]$BuildOnly,
    [switch]$Monitor
)

$ErrorActionPreference = "Stop"

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$firmwareDir = Join-Path $repo "firmware\pocket_card"

function Get-IdfPathCandidates {
    $candidates = [System.Collections.Generic.List[string]]::new()
    if ($env:IDF_PATH) { $candidates.Add($env:IDF_PATH) }
    $localPathFile = Join-Path $repo ".idf-path.local"
    if (Test-Path -LiteralPath $localPathFile) {
        $localPath = (Get-Content -LiteralPath $localPathFile -ErrorAction SilentlyContinue |
            Where-Object { $_ -and -not $_.Trim().StartsWith("#") } |
            Select-Object -First 1).Trim()
        if ($localPath) {
            if (-not [System.IO.Path]::IsPathRooted($localPath)) {
                $localPath = Join-Path $repo $localPath
            }
            $candidates.Add($localPath)
        }
    }
    $candidates.Add((Join-Path $env:USERPROFILE "esp\esp-idf"))
    $frameworksRoot = "C:\Espressif\frameworks"
    if (Test-Path -LiteralPath $frameworksRoot) {
        Get-ChildItem -LiteralPath $frameworksRoot -Directory -Filter "esp-idf-v*" |
            Sort-Object Name -Descending |
            ForEach-Object { $candidates.Add($_.FullName) }
    }
    return @($candidates | Where-Object { $_ } | Select-Object -Unique)
}

function Test-SerialPortFree {
    param([string]$PortName)
    try {
        $port = New-Object System.IO.Ports.SerialPort $PortName, 115200, 'None', 8, 'One'
        $port.ReadTimeout = 250
        $port.WriteTimeout = 250
        $port.Open()
        $port.Close()
        $port.Dispose()
        return $true
    }
    catch {
        return $false
    }
}

function Show-ComPortBusyHelp {
    param([string]$PortName)
    Write-Host ""
    Write-Host "COM port $PortName is busy." -ForegroundColor Red
    Write-Host "Common causes:"
    Write-Host "  - an idf.py monitor still running (including a Cursor agent background terminal)"
    Write-Host "  - Arduino Serial Monitor or another terminal on the same port"
    Write-Host ""
    Write-Host "Fix:"
    Write-Host "  1. Close any other serial monitor using $PortName"
    Write-Host "  2. Unplug/replug the USB cable"
    Write-Host "  3. Retry: .\scripts\pocket_card_mcp_bench.ps1 -Port $PortName"
    Write-Host ""
    Write-Host "Tip: flash first without -Monitor, then open monitor only after flash completes."
    Write-Host ""
}

    if (Get-Command idf.py -ErrorAction SilentlyContinue) { return }
    foreach ($candidate in Get-IdfPathCandidates) {
        $exportScript = Join-Path $candidate "export.ps1"
        if (-not (Test-Path -LiteralPath $exportScript)) { continue }
        Write-Host "==> Loading ESP-IDF from $candidate"
        . $exportScript
        if (Get-Command idf.py -ErrorAction SilentlyContinue) { return }
    }
    throw "ESP-IDF not found. Install v5.4.x or create .idf-path.local"
}

Push-Location $repo
try {
    Ensure-EspIdf
    Push-Location $firmwareDir
    try {
        if (-not (Test-Path -LiteralPath "sdkconfig") -or
            -not (Select-String -Path "sdkconfig" -Pattern 'CONFIG_POCKET_CARD_(MCP23017_BENCH|RUNTIME_PROBE|PLAYER_APP)=y' -Quiet -ErrorAction SilentlyContinue)) {
            Write-Host "==> Applying Pocket Card sdkconfig defaults"
            idf.py reconfigure | Out-Null
        }
        Write-Host "==> Build Pocket Card firmware"
        idf.py build
        if ($LASTEXITCODE -ne 0) { throw "Build failed (exit $LASTEXITCODE)" }

        if ($BuildOnly) {
            Write-Host "Build complete. Flash with: .\scripts\pocket_card_mcp_bench.ps1 -Port COM3 -Monitor"
            return
        }

        if ([string]::IsNullOrWhiteSpace($Port)) {
            throw "No serial port. Pass -Port COMx or set `$env:POCKET_CARD_PORT"
        }

        if (-not (Test-SerialPortFree -PortName $Port)) {
            Show-ComPortBusyHelp -PortName $Port
            throw "Serial port $Port is not available"
        }

        if ($Monitor) {
            Write-Host "==> Flash on $Port"
            idf.py -p $Port flash
            if ($LASTEXITCODE -ne 0) { throw "Flash failed (exit $LASTEXITCODE)" }
            Write-Host "==> Monitor on $Port (Ctrl+] to quit)"
            idf.py -p $Port monitor
        }
        else {
            Write-Host "==> Flash on $Port"
            idf.py -p $Port flash
        }
    }
    finally {
        Pop-Location
    }
}
finally {
    Pop-Location
}
