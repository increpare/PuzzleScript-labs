param(
    [string]$Port = $env:POCKET_CARD_PORT,
    [ValidateSet("Release", "Debug")]
    [string]$Config = "Release",
    [switch]$BuildOnly,
    [switch]$Monitor,
    [switch]$SkipNative
)

$ErrorActionPreference = "Stop"

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$buildDir = Join-Path $repo "build"
$firmwareDir = Join-Path $repo "firmware\pocket_card"
$fixtureSource = Join-Path $repo "src\demo\sokoban_basic.txt"
$fixtureOut = Join-Path $repo "firmware\pocket_card\main\sokoban_basic.ir.json"
$fixtureScript = Join-Path $repo "scripts\build_pocket_card_fixture.js"

function Invoke-RepoCommand {
    param(
        [string]$Label,
        [scriptblock]$Command
    )
    Write-Host "==> $Label"
    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "$Label failed (exit $LASTEXITCODE)"
    }
}

function Get-IdfPathCandidates {
    $candidates = [System.Collections.Generic.List[string]]::new()

    if ($env:IDF_PATH) {
        $candidates.Add($env:IDF_PATH)
    }

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

function Ensure-EspIdf {
    if (Get-Command idf.py -ErrorAction SilentlyContinue) {
        return
    }

    foreach ($candidate in Get-IdfPathCandidates) {
        $exportScript = Join-Path $candidate "export.ps1"
        if (-not (Test-Path -LiteralPath $exportScript)) {
            continue
        }
        Write-Host "==> Loading ESP-IDF from $candidate"
        . $exportScript
        if (Get-Command idf.py -ErrorAction SilentlyContinue) {
            return
        }
    }

    throw @"
ESP-IDF is not installed (or not on PATH). This repo builds firmware for ESP32 chips;
you need Espressif's ESP-IDF toolchain before idf.py can run.

One-time setup on Windows:
  1. Download the ESP-IDF Tools Installer:
     https://docs.espressif.com/projects/esp-idf/en/v5.4.2/esp32/get-started/windows-setup.html
  2. Run it and choose Express install with ESP-IDF v5.4.x.
  3. Reopen PowerShell and run this script again.

After install, the script should auto-find C:\Espressif\frameworks\esp-idf-v5.4.x.
If it does not, create a one-line file in the repo root:

  .idf-path.local
  C:\Espressif\frameworks\esp-idf-v5.4.4

(Use your actual path from the installer.)
"@
}

function Get-CmakeGenerator {
    param([string]$CachePath)
    if (-not (Test-Path -LiteralPath $CachePath)) {
        return $null
    }
    foreach ($line in Get-Content -LiteralPath $CachePath) {
        if ($line -match '^CMAKE_GENERATOR:INTERNAL=(.+)$') {
            return $Matches[1]
        }
    }
    return $null
}

function Ensure-NativeCompiler {
    param(
        [string]$Configuration
    )

    $cachePath = Join-Path $buildDir "CMakeCache.txt"
    $generator = Get-CmakeGenerator -CachePath $cachePath

    if (-not $generator) {
        Invoke-RepoCommand "Configure native build (Visual Studio 2022)" {
            cmake -S $repo -B $buildDir -G "Visual Studio 17 2022" -A x64 -DPS_MASK_WORD_BITS=64
        }
    }
    elseif ($generator -notmatch "Visual Studio") {
        throw @"
The existing build/ directory uses '$generator', but this script expects Visual Studio on Windows.
Remove build/ and rerun, or configure manually with:
  cmake -S . -B build -G "Visual Studio 17 2022" -A x64 -DPS_MASK_WORD_BITS=64
"@
    }

    Invoke-RepoCommand "Build puzzlescript_cpp ($Configuration)" {
        cmake --build $buildDir --config $Configuration --target puzzlescript_cpp
    }

    $candidates = @(
        Join-Path $buildDir "native\$Configuration\puzzlescript_cpp.exe",
        Join-Path $buildDir "native\puzzlescript_cpp.exe"
    )
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }

    throw "puzzlescript_cpp.exe not found after build (config=$Configuration)"
}

function Ensure-Esp32S3Target {
    $sdkconfig = Join-Path $firmwareDir "sdkconfig"
    if ((Test-Path -LiteralPath $sdkconfig) -and (Select-String -Path $sdkconfig -Pattern 'CONFIG_IDF_TARGET="esp32s3"' -Quiet)) {
        return
    }
    Push-Location $firmwareDir
    try {
        Invoke-RepoCommand "Set ESP-IDF target esp32s3" { idf.py set-target esp32s3 }
    }
    finally {
        Pop-Location
    }
}

Push-Location $repo
try {
    Ensure-EspIdf

    $compiler = $null
    if (-not $SkipNative) {
        $compiler = Ensure-NativeCompiler -Configuration $Config
    }
    else {
        $candidates = @(
            Join-Path $buildDir "native\$Config\puzzlescript_cpp.exe",
            Join-Path $buildDir "native\Release\puzzlescript_cpp.exe",
            Join-Path $buildDir "native\Debug\puzzlescript_cpp.exe"
        )
        foreach ($candidate in $candidates) {
            if (Test-Path -LiteralPath $candidate) {
                $compiler = (Resolve-Path -LiteralPath $candidate).Path
                break
            }
        }
        if (-not $compiler) {
            throw "SkipNative set but puzzlescript_cpp.exe was not found under build/native/"
        }
    }

    Invoke-RepoCommand "Generate Pocket Card IR fixture" {
        node $fixtureScript `
            --binary $compiler `
            --source $fixtureSource `
            --out $fixtureOut
    }

    Ensure-Esp32S3Target

    Push-Location $firmwareDir
    try {
        Invoke-RepoCommand "Build Pocket Card firmware" { idf.py build }

        if ($BuildOnly) {
            Write-Host "Build complete. Flash with: .\scripts\pocket_card_probe.ps1 -Port COM3"
            return
        }

        if ([string]::IsNullOrWhiteSpace($Port)) {
            throw @"
No serial port specified. Pass -Port COM3 or set `$env:POCKET_CARD_PORT.
Build finished; firmware is at firmware\pocket_card\build\puzzlescript_pocket_card_probe.bin
"@
        }

        if ($Monitor) {
            Invoke-RepoCommand "Flash and monitor on $Port" { idf.py -p $Port flash monitor }
        }
        else {
            Invoke-RepoCommand "Flash on $Port" { idf.py -p $Port flash }
        }
    }
    finally {
        Pop-Location
    }
}
finally {
    Pop-Location
}
