param(
    [string]$Corpus = "src/tests/solver_tests",
    [string]$BuildDir = "build-32",
    [string]$ExporterBuildDir = "build-32",
    [string]$OutputDir = "build/gba/solver-parity",
    [int]$TimeoutMs = 1000,
    [int]$Jobs = 0,
    [string]$Game = "",
    [string]$SolverReport = ""
)

$ErrorActionPreference = "Stop"

function Quote-NativeArgument([string]$Value) {
    if ($Value.Length -eq 0) { return '""' }
    if ($Value -notmatch '[\s"]') { return $Value }
    # The paths and solver tokens used here never end in a backslash.  Escape
    # embedded quotes and surround whitespace-containing arguments.
    return '"' + $Value.Replace('"', '\"') + '"'
}

function Invoke-CapturedProcess([string]$FilePath, [string[]]$Arguments) {
    $start = [System.Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $FilePath
    $start.Arguments = (($Arguments | ForEach-Object { Quote-NativeArgument ([string]$_) }) -join ' ')
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $start
    if (!$process.Start()) { throw "Could not start $FilePath" }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $process.WaitForExit()
    $stdoutTask.Wait()
    $stderrTask.Wait()
    return [pscustomobject]@{
        ExitCode = $process.ExitCode
        Stdout = $stdoutTask.Result
        Stderr = $stderrTask.Result
    }
}

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$corpusPath = (Resolve-Path (Join-Path $repo $Corpus)).Path
$buildPath = (Resolve-Path (Join-Path $repo $BuildDir)).Path
$exportBuildPath = (Resolve-Path (Join-Path $repo $ExporterBuildDir)).Path
$outputPath = Join-Path $repo $OutputDir
New-Item -ItemType Directory -Force -Path $outputPath | Out-Null

$solver = Join-Path $buildPath "native/Release/puzzlescript_solver.exe"
$exporter = Join-Path $exportBuildPath "native/Release/puzzlescript_cpp.exe"
$replay = Join-Path $buildPath "native/Release/puzzlescript_gba_solution_replay.exe"
$cmake = ""
$cachePath = Join-Path $buildPath "CMakeCache.txt"
if (Test-Path $cachePath) {
    $cacheEntry = Select-String -Path $cachePath -Pattern '^CMAKE_COMMAND:INTERNAL=(.+)$' | Select-Object -First 1
    if ($cacheEntry) { $cmake = $cacheEntry.Matches[0].Groups[1].Value }
}
if (!$cmake) {
    $cmakeCommand = Get-Command cmake.exe -ErrorAction SilentlyContinue
    if ($cmakeCommand) { $cmake = $cmakeCommand.Source }
}
if (!(Test-Path $solver) -or !(Test-Path $exporter)) {
    throw "Build the Release puzzlescript_solver and puzzlescript_cpp targets first."
}
if (!$cmake -or !(Test-Path $cmake)) { throw "Could not locate cmake.exe." }
if ($Jobs -le 0) { $Jobs = [Math]::Max(1, [Environment]::ProcessorCount - 1) }

if ($SolverReport) {
    $solverReportPath = (Resolve-Path (Join-Path $repo $SolverReport)).Path
    $solverJson = Get-Content -Raw -LiteralPath $solverReportPath
} else {
    $solverReportPath = Join-Path $outputPath "native-solver-report.json"
    $solverProgressPath = Join-Path $outputPath "native-solver-progress.log"
    $solverArgs = @($corpusPath, "--timeout-ms", $TimeoutMs, "--jobs", $Jobs, "--json", "--no-solutions")
    if ($Game) { $solverArgs += @("--game", $Game) }
    Write-Host "Running native solver (timeout ${TimeoutMs}ms, jobs $Jobs)..."
    $solverProcess = Invoke-CapturedProcess $solver $solverArgs
    [System.IO.File]::WriteAllText($solverProgressPath, $solverProcess.Stderr)
    if ($solverProcess.ExitCode -ne 0) { throw "Native solver failed; see $solverProgressPath" }
    $solverJson = $solverProcess.Stdout
    [System.IO.File]::WriteAllText($solverReportPath, $solverJson)
}
$solverData = $solverJson | ConvertFrom-Json
$solved = @($solverData.results | Where-Object { $_.status -eq "solved" })
if ($Game) {
    $solved = @($solved | Where-Object { [string]$_.game -like "*$Game*" })
}
Write-Host "Native solver found $($solved.Count) solved board levels."
if ($solved.Count -eq 0) {
    throw "No solved board levels matched the requested corpus/game; refusing a false-green parity report."
}

$parityResults = [System.Collections.Generic.List[object]]::new()
$groups = @($solved | Group-Object game)
$gameOrdinal = 0
foreach ($group in $groups) {
    ++$gameOrdinal
    $gameName = [string]$group.Name
    $sourcePath = Join-Path $corpusPath $gameName
    $safeName = [System.IO.Path]::GetFileNameWithoutExtension($gameName) -replace '[^A-Za-z0-9._-]', '_'
    $exportPath = Join-Path $outputPath ("generated/{0:D3}-{1}" -f $gameOrdinal, $safeName)
    New-Item -ItemType Directory -Force -Path $exportPath | Out-Null
    Write-Host "[$gameOrdinal/$($groups.Count)] Exporting $gameName ($($group.Count) solved levels)..."

    $exportLog = Join-Path $exportPath "export.log"
    $exportProcess = Invoke-CapturedProcess $exporter @("export-gba", $sourcePath, "--out", $exportPath, "--no-mmutil")
    [System.IO.File]::WriteAllText($exportLog, $exportProcess.Stdout + $exportProcess.Stderr)
    if ($exportProcess.ExitCode -ne 0) {
        foreach ($solution in $group.Group) {
            $parityResults.Add([pscustomobject]@{
                game = $gameName; level = [int]$solution.level; status = "export_failed"
                solution_length = [int]$solution.solution_length; detail = $exportLog
            })
        }
        continue
    }

    $configureProcess = Invoke-CapturedProcess $cmake @("-S", $repo, "-B", $buildPath, "-DPS_GBA_PARITY_EXPORT_DIR=$exportPath")
    [System.IO.File]::WriteAllText((Join-Path $exportPath "configure.log"), $configureProcess.Stdout + $configureProcess.Stderr)
    if ($configureProcess.ExitCode -ne 0) { throw "CMake configure failed for $gameName" }
    $buildProcess = Invoke-CapturedProcess $cmake @("--build", $buildPath, "--config", "Release", "--target", "puzzlescript_gba_solution_replay", "--parallel")
    [System.IO.File]::WriteAllText((Join-Path $exportPath "build.log"), $buildProcess.Stdout + $buildProcess.Stderr)
    if ($buildProcess.ExitCode -ne 0) { throw "Parity replay build failed for $gameName" }
    if (!(Test-Path $replay)) { throw "Parity replay executable was not produced: $replay" }

    foreach ($solution in $group.Group) {
        $inputText = @($solution.solution) -join ','
        $replayProcess = Invoke-CapturedProcess $replay @($sourcePath, ([string]$solution.level), $inputText)
        $exitCode = $replayProcess.ExitCode
        $replayText = ($replayProcess.Stdout + $replayProcess.Stderr).Trim()
        try {
            $detail = $replayText | ConvertFrom-Json
            $status = [string]$detail.status
        } catch {
            $detail = $replayText
            $status = "runner_error"
        }
        if ($exitCode -ne 0 -and $status -eq "pass") { $status = "runner_error" }
        $parityResults.Add([pscustomobject]@{
            game = $gameName
            level = [int]$solution.level
            status = $status
            solution_length = [int]$solution.solution_length
            solver_elapsed_ms = [double]$solution.elapsed_ms
            detail = $detail
        })
        if ($status -ne "pass") {
            Write-Warning "$gameName level $($solution.level): $status - $replayText"
        }
    }
}

$passed = @($parityResults | Where-Object { $_.status -eq "pass" }).Count
$failed = @($parityResults | Where-Object { $_.status -eq "fail" }).Count
$exportFailed = @($parityResults | Where-Object { $_.status -eq "export_failed" }).Count
$runnerErrors = @($parityResults | Where-Object { $_.status -eq "runner_error" }).Count
$audioMismatchLevels = @($parityResults | Where-Object {
    ($_.detail -is [pscustomobject]) -and
        ([int]$_.detail.audio_mismatches -gt 0)
}).Count
$report = [ordered]@{
    generated_at = [DateTime]::UtcNow.ToString("o")
    corpus = $corpusPath
    solver_timeout_ms = $TimeoutMs
    solver_jobs = $Jobs
    game_filter = $Game
    solver_report = $solverReportPath
    verification = "hard gate: exact native-player/GBA state, level transitions, step flags, again ticks, RNG, messages, and ordered gameplay/UI audio events"
    solver_totals = $solverData.totals
    parity_totals = [ordered]@{
        attempted = $parityResults.Count
        passed = $passed
        failed = $failed
        export_failed = $exportFailed
        runner_errors = $runnerErrors
        audio_matched = $passed
        audio_mismatch = $audioMismatchLevels
    }
    results = $parityResults
}
$reportPath = Join-Path $outputPath "gba-solver-parity-report.json"
$report | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 -LiteralPath $reportPath
$verifiedPath = Join-Path $outputPath "verified-levels.csv"
@($parityResults | Where-Object { $_.status -eq "pass" } | ForEach-Object {
    [pscustomobject]@{
        game = $_.game
        level = $_.level
        solution_length = $_.solution_length
        replayed_inputs = if ($_.detail -is [pscustomobject] -and $null -ne $_.detail.inputs) { [int]$_.detail.inputs } else { $_.solution_length }
        startup_won = if ($_.detail -is [pscustomobject] -and $null -ne $_.detail.startup_won) { [bool]$_.detail.startup_won } else { $false }
        again_ticks = if ($_.detail -is [pscustomobject] -and $null -ne $_.detail.again_ticks) { [int]$_.detail.again_ticks } else { 0 }
        message_confirms = if ($_.detail -is [pscustomobject] -and $null -ne $_.detail.message_confirms) { [int]$_.detail.message_confirms } else { 0 }
        audio_mismatches = if ($_.detail -is [pscustomobject] -and $null -ne $_.detail.audio_mismatches) { [int]$_.detail.audio_mismatches } else { 0 }
        first_audio_mismatch = if ($_.detail -is [pscustomobject]) { [string]$_.detail.first_audio_mismatch } else { "" }
        solver_elapsed_ms = $_.solver_elapsed_ms
    }
}) | Export-Csv -NoTypeInformation -Encoding UTF8 -LiteralPath $verifiedPath
$failuresPath = Join-Path $outputPath "parity-failures.csv"
@($parityResults | Where-Object { $_.status -ne "pass" } | ForEach-Object {
    [pscustomobject]@{
        game = $_.game
        level = $_.level
        status = $_.status
        solution_length = $_.solution_length
        detail = if ($_.detail -is [string]) { $_.detail } else { $_.detail | ConvertTo-Json -Compress -Depth 10 }
    }
}) | Export-Csv -NoTypeInformation -Encoding UTF8 -LiteralPath $failuresPath
$audioMismatchPath = Join-Path $outputPath "audio-mismatches.csv"
@($parityResults | Where-Object {
    ($_.detail -is [pscustomobject]) -and
        ([int]$_.detail.audio_mismatches -gt 0)
} | ForEach-Object {
    [pscustomobject]@{
        game = $_.game
        level = $_.level
        audio_mismatches = [int]$_.detail.audio_mismatches
        first_audio_mismatch = [string]$_.detail.first_audio_mismatch
    }
}) | Export-Csv -NoTypeInformation -Encoding UTF8 -LiteralPath $audioMismatchPath
Write-Host "Parity: $passed passed, $failed diverged, $exportFailed could not export, $runnerErrors runner errors."
Write-Host "Audio events: $passed passing levels matched, $audioMismatchLevels levels had hard-gate mismatches."
Write-Host "Report: $reportPath"
Write-Host "Verified levels: $verifiedPath"
Write-Host "Failures: $failuresPath"
Write-Host "Audio mismatches: $audioMismatchPath"
if ($failed -gt 0 -or $exportFailed -gt 0 -or $runnerErrors -gt 0) { exit 1 }
