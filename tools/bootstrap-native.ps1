$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$jucePath = Join-Path $projectRoot 'external\JUCE'
if (-not (Test-Path -LiteralPath (Join-Path $jucePath 'CMakeLists.txt'))) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $jucePath) | Out-Null
  git clone --depth 1 --branch 8.0.15 https://github.com/juce-framework/JUCE.git $jucePath
}
$cmake = (Get-Command cmake -ErrorAction SilentlyContinue).Source
if (-not $cmake) { $cmake = 'C:\Program Files\CMake\bin\cmake.exe' }
if (-not (Test-Path -LiteralPath $cmake)) { throw 'CMake is not installed.' }
& $cmake -S (Join-Path $projectRoot 'native') -B (Join-Path $projectRoot 'native\build') -G 'Visual Studio 17 2022' -A x64
& $cmake --build (Join-Path $projectRoot 'native\build') --config Release --target PlaybackEngineProbe --parallel 4
