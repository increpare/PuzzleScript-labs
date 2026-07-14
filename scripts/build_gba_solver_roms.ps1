param(
    [string]$Corpus = "src\tests\solver_tests",
    [string]$OutputDirectory = "build\gba\solver-tests\roms\all-abi5",
    [switch]$Rebuild
)

$ErrorActionPreference = "Stop"

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$corpusPath = (Resolve-Path (Join-Path $repo $Corpus)).Path
$compiler = (Resolve-Path (Join-Path $repo "build-32\native\Release\puzzlescript_cpp.exe")).Path
$firmware = Join-Path $repo "firmware\gba"
$make = "C:\devkitPro\msys2\usr\bin\make.exe"
if (-not (Test-Path -LiteralPath $make)) { throw "devkitPro make not found: $make" }

$env:DEVKITPRO = "C:/devkitPro"
$env:DEVKITARM = "C:/devkitPro/devkitARM"
$env:PATH = "C:\devkitPro\devkitARM\bin;C:\devkitPro\tools\bin;C:\devkitPro\msys2\usr\bin;" + $env:PATH

$romDirectory = Join-Path $repo $OutputDirectory
$reportPath = Join-Path $romDirectory "rom-build-report.json"
$logDirectory = Join-Path $romDirectory "logs"
New-Item -ItemType Directory -Force -Path $romDirectory, $logDirectory | Out-Null

$sources = @(Get-ChildItem -LiteralPath $corpusPath -File -Filter "*.txt" | Sort-Object FullName)
$records = [System.Collections.Generic.List[object]]::new()
$started = [DateTimeOffset]::UtcNow

function Write-Report([bool]$complete) {
    $successful = @($records | Where-Object success).Count
    $report = [ordered]@{
        format = "puzzlescript-gba-rom-build-v1"
        corpus = $corpusPath
        complete = $complete
        started_utc = $started.ToString("o")
        updated_utc = [DateTimeOffset]::UtcNow.ToString("o")
        summary = [ordered]@{
            games = $sources.Count
            attempted = $records.Count
            successful = $successful
            failed = $records.Count - $successful
            remaining = $sources.Count - $records.Count
        }
        games = $records
    }
    $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $reportPath -Encoding UTF8
}

for ($index = 0; $index -lt $sources.Count; ++$index) {
    $source = $sources[$index]
    $slug = ($source.BaseName.ToLowerInvariant() -replace "[^a-z0-9]+", "-").Trim("-")
    if ([string]::IsNullOrWhiteSpace($slug)) { $slug = "game" }
    $baseName = "{0:D3}-{1}" -f $index, $slug
    $romPath = Join-Path $romDirectory ($baseName + ".gba")
    $logPath = Join-Path $logDirectory ($baseName + ".log")

    if (-not $Rebuild -and (Test-Path -LiteralPath $romPath)) {
        $rom = Get-Item -LiteralPath $romPath
        $records.Add([pscustomobject][ordered]@{
            index = $index
            name = $source.BaseName
            source = $source.FullName.Substring($repo.Length + 1)
            success = $true
            reused = $true
            rom = $rom.FullName.Substring($repo.Length + 1)
            rom_bytes = $rom.Length
            log = if (Test-Path -LiteralPath $logPath) { $logPath.Substring($repo.Length + 1) } else { $null }
        })
        Write-Host ("[{0}/{1}] reused {2}" -f ($index + 1), $sources.Count, $source.BaseName)
        Write-Report $false
        continue
    }

    Write-Host ("[{0}/{1}] building {2}" -f ($index + 1), $sources.Count, $source.BaseName)
    $stopwatch = [Diagnostics.Stopwatch]::StartNew()
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $buildOutput = (& $make -C $firmware "GAME=$($source.FullName)" "PUZZLESCRIPT_CPP=$compiler" AUDIO=0 all 2>&1 | Out-String)
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousErrorActionPreference
    $stopwatch.Stop()
    $buildOutput | Set-Content -LiteralPath $logPath -Encoding UTF8

    if ($exitCode -eq 0 -and (Test-Path -LiteralPath (Join-Path $firmware "puzzlescript_gba.gba"))) {
        Copy-Item -LiteralPath (Join-Path $firmware "puzzlescript_gba.gba") -Destination $romPath -Force
        $rom = Get-Item -LiteralPath $romPath
        $records.Add([pscustomobject][ordered]@{
            index = $index
            name = $source.BaseName
            source = $source.FullName.Substring($repo.Length + 1)
            success = $true
            reused = $false
            seconds = [Math]::Round($stopwatch.Elapsed.TotalSeconds, 3)
            rom = $rom.FullName.Substring($repo.Length + 1)
            rom_bytes = $rom.Length
            log = $logPath.Substring($repo.Length + 1)
        })
    } else {
        $tail = (($buildOutput -split "`r?`n") | Where-Object { $_.Trim() } | Select-Object -Last 12) -join "`n"
        $records.Add([pscustomobject][ordered]@{
            index = $index
            name = $source.BaseName
            source = $source.FullName.Substring($repo.Length + 1)
            success = $false
            reused = $false
            seconds = [Math]::Round($stopwatch.Elapsed.TotalSeconds, 3)
            error = $tail
            log = $logPath.Substring($repo.Length + 1)
        })
    }
    Write-Report $false
}

Write-Report $true
$successCount = @($records | Where-Object success).Count
Write-Host ("GBA ROM build complete: {0}/{1} succeeded; report: {2}" -f $successCount, $sources.Count, $reportPath)
if ($successCount -ne $sources.Count) { exit 1 }
