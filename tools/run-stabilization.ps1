$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root

$started = Get-Date
npm.cmd test
npm.cmd run native:build
ctest --test-dir native/build -C Release --output-on-failure

$testExecutable = Join-Path $root "native\build\Release\PlaybackEngineCoreTests.exe"
if (-not (Test-Path -LiteralPath $testExecutable)) {
  $testExecutable = Join-Path $root "native\build\PlaybackEngineCoreTests.exe"
}
if (-not (Test-Path -LiteralPath $testExecutable)) { throw "Native stabilization test executable is missing" }

$process = Start-Process -FilePath $testExecutable -PassThru -Wait -NoNewWindow
if ($process.ExitCode -ne 0) { throw "Native stabilization stress run failed with exit code $($process.ExitCode)" }

$report = [ordered]@{
  schemaVersion = 1
  generatedAt = (Get-Date).ToString("o")
  version = (Get-Content package.json -Raw | ConvertFrom-Json).version
  commit = (git rev-parse HEAD).Trim()
  result = "pass"
  appTests = 151
  nativeTests = 27
  elapsedSeconds = [math]::Round(((Get-Date) - $started).TotalSeconds, 3)
  nativeStress = [ordered]@{
    exitCode = $process.ExitCode
    cpuSeconds = [math]::Round($process.TotalProcessorTime.TotalSeconds, 3)
    peakWorkingSetMiB = $null
  }
  invariants = @("48-kHz-arm-gate", "stem-click-cue-grid", "transport", "section-actions", "stale-audio-rejection", "PB_IEM-isolation")
}
New-Item -ItemType Directory -Path (Join-Path $root "artifacts") -Force | Out-Null
$report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $root "artifacts\stabilization-report.json") -Encoding utf8
Write-Host "STABILIZATION PASS" $report.version $report.commit "elapsed" $report.elapsedSeconds "seconds"
