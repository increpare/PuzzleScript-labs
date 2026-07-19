param(
    [string]$Corpus = "src\tests\solver_tests",
    [string]$OutputDirectory = "",
    [switch]$Audio,
    [ValidateRange(0, 1024)]
    [int]$AudioVolume = 128,
    [switch]$Rebuild,
    [switch]$Resume
)

$ErrorActionPreference = "Stop"

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$corpusPath = (Resolve-Path (Join-Path $repo $Corpus)).Path
$compiler = (Resolve-Path (Join-Path $repo "build-32\native\Release\puzzlescript_cpp.exe")).Path
$firmware = Join-Path $repo "firmware\gba"
$generatedDirectory = Join-Path $firmware "generated"
$manifestPath = Join-Path $generatedDirectory "gba_manifest.json"
$make = "C:\devkitPro\msys2\usr\bin\make.exe"
if (-not (Test-Path -LiteralPath $make)) { throw "devkitPro make not found: $make" }
$shell = "C:/devkitPro/msys2/usr/bin/sh.exe"

$abiHeader = Get-Content -LiteralPath (Join-Path $repo "native\include\puzzlescript\gba.h")
$abiMatch = [regex]::Match(($abiHeader -join "`n"), '#define\s+PS_GBA_GAME_ABI_VERSION\s+(\d+)')
if (-not $abiMatch.Success) { throw "Could not determine PS_GBA_GAME_ABI_VERSION" }
$abiVersion = [int]$abiMatch.Groups[1].Value
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $suffix = if ($Audio) { "audio" } else { "muted" }
    $OutputDirectory = "build\gba\solver-tests\roms\all-abi$abiVersion-$suffix"
}

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
$completedIndices = [System.Collections.Generic.HashSet[int]]::new()

if ($Resume -and (Test-Path -LiteralPath $reportPath)) {
    $priorReport = Get-Content -LiteralPath $reportPath -Raw | ConvertFrom-Json
    if ($priorReport.format -ne "puzzlescript-gba-rom-build-v2") {
        throw "Cannot resume unrecognized report format: $($priorReport.format)"
    }
    if ([IO.Path]::GetFullPath($priorReport.corpus) -ne [IO.Path]::GetFullPath($corpusPath)) {
        throw "Cannot resume report for a different corpus: $($priorReport.corpus)"
    }
    if ($priorReport.started_utc) {
        $started = [DateTimeOffset]::Parse($priorReport.started_utc)
    }
    foreach ($record in @($priorReport.games)) {
        $recordIndex = [int]$record.index
        $recordRom = if ($record.rom) { Join-Path $repo $record.rom } else { $null }
        $validRecord = $record.success -and $recordRom -and (Test-Path -LiteralPath $recordRom)
        if ($validRecord -and $completedIndices.Add($recordIndex)) {
            $records.Add($record)
        }
    }
    Write-Host ("Resuming after {0}/{1} successful ROMs" -f $records.Count, $sources.Count)
}

function Write-Report([bool]$complete) {
    $successful = @($records | Where-Object success).Count
    $report = [ordered]@{
        format = "puzzlescript-gba-rom-build-v2"
        corpus = $corpusPath
        abi_version = $abiVersion
        audio_requested = [bool]$Audio
        audio_volume = $AudioVolume
        complete = $complete
        started_utc = $started.ToString("o")
        updated_utc = [DateTimeOffset]::UtcNow.ToString("o")
        summary = [ordered]@{
            games = $sources.Count
            attempted = $records.Count
            successful = $successful
            failed = $records.Count - $successful
            remaining = $sources.Count - $records.Count
            audio_enabled = @($records | Where-Object audio_enabled).Count
            silent = @($records | Where-Object { $_.success -and -not $_.audio_enabled }).Count
        }
        games = $records
    }
    $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $reportPath -Encoding UTF8
}

for ($index = 0; $index -lt $sources.Count; ++$index) {
    if ($Resume -and $completedIndices.Contains($index)) { continue }

    $source = $sources[$index]
    $slug = ($source.BaseName.ToLowerInvariant() -replace "[^a-z0-9]+", "-").Trim("-")
    if ([string]::IsNullOrWhiteSpace($slug)) { $slug = "game" }
    $baseName = "{0:D3}-{1}" -f $index, $slug
    $romPath = Join-Path $romDirectory ($baseName + ".gba")
    $logPath = Join-Path $logDirectory ($baseName + ".log")

    if (-not $Rebuild -and -not $Resume -and (Test-Path -LiteralPath $romPath)) {
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
    $preflightOutput = (& $compiler export-gba $source.FullName --out $generatedDirectory --no-mmutil 2>&1 | Out-String)
    $preflightExitCode = $LASTEXITCODE
    $soundSeedCount = 0
    $audioEnabled = $false
    if ($preflightExitCode -eq 0 -and (Test-Path -LiteralPath $manifestPath)) {
        $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
        $soundSeedCount = [int]$manifest.sound_seed_count
        $audioEnabled = [bool]$Audio -and $soundSeedCount -gt 0
    }
    $audioFlag = if ($audioEnabled) { 1 } else { 0 }
    $buildOutput = ""
    $exitCode = $preflightExitCode
    if ($preflightExitCode -eq 0) {
        $firmwareBuild = if ($audioEnabled) { "build-batch-audio" } else { "build-batch-muted" }
        $firmwareTarget = if ($audioEnabled) { "puzzlescript_gba_batch_audio" } else { "puzzlescript_gba_batch_muted" }
        $buildOutput = (& $make "SHELL=$shell" -C $firmware "GAME=$($source.FullName)" `
            "PUZZLESCRIPT_CPP=$compiler" "AUDIO=$audioFlag" "AUDIO_VOLUME=$AudioVolume" `
            "BUILD=$firmwareBuild" "TARGET=$firmwareTarget" all 2>&1 | Out-String)
        $exitCode = $LASTEXITCODE
    }
    $ErrorActionPreference = $previousErrorActionPreference
    $stopwatch.Stop()
    (($preflightOutput.TrimEnd(), $buildOutput.TrimEnd()) -join "`n") |
        Set-Content -LiteralPath $logPath -Encoding UTF8

    $builtRomPath = if ($audioEnabled) {
        Join-Path $firmware "puzzlescript_gba_batch_audio.gba"
    } else {
        Join-Path $firmware "puzzlescript_gba_batch_muted.gba"
    }
    if ($exitCode -eq 0 -and (Test-Path -LiteralPath $builtRomPath)) {
        Copy-Item -LiteralPath $builtRomPath -Destination $romPath -Force
        $rom = Get-Item -LiteralPath $romPath
        $records.Add([pscustomobject][ordered]@{
            index = $index
            name = $source.BaseName
            source = $source.FullName.Substring($repo.Length + 1)
            success = $true
            reused = $false
            audio_enabled = $audioEnabled
            sound_seed_count = $soundSeedCount
            audio_volume = if ($audioEnabled) { $AudioVolume } else { 0 }
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
            audio_enabled = $audioEnabled
            sound_seed_count = $soundSeedCount
            audio_volume = if ($audioEnabled) { $AudioVolume } else { 0 }
            seconds = [Math]::Round($stopwatch.Elapsed.TotalSeconds, 3)
            error = if ($preflightExitCode -ne 0) {
                (($preflightOutput -split "`r?`n") | Where-Object { $_.Trim() } | Select-Object -Last 12) -join "`n"
            } else {
                $tail
            }
            log = $logPath.Substring($repo.Length + 1)
        })
    }
    Write-Report $false
}

Write-Report $true
$successCount = @($records | Where-Object success).Count
Write-Host ("GBA ROM build complete: {0}/{1} succeeded; report: {2}" -f $successCount, $sources.Count, $reportPath)
if ($successCount -ne $sources.Count) { exit 1 }
