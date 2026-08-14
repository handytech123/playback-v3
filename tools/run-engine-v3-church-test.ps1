param(
  [Parameter(Mandatory = $true)][string]$ManifestPath,
  [int]$SongIndex = 0,
  [string]$DeviceName = "Dante Virtual Soundcard (x64)",
  [ValidateSet(128, 256, 512, 1024)][int]$BlockFrames = 256,
  [int]$Seconds = 10,
  [switch]$Audible,
  [switch]$ConfirmAudible,
  [switch]$FullDuplex
)

$ErrorActionPreference = "Stop"
$workspace = Split-Path -Parent $PSScriptRoot
$harness = Join-Path $workspace "native\build\PlaybackEngineV3Test_artefacts\Release\PlaybackEngineV3Test.exe"
if (-not (Test-Path -LiteralPath $harness -PathType Leaf)) { throw "Build PlaybackEngineV3Test first: $harness" }
if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) { throw "Confirmed-set manifest not found: $ManifestPath" }
if ($Audible -and -not $ConfirmAudible) { throw "Audible output is locked. Add -ConfirmAudible only after console gains and routing are safe." }

$appProcesses = @(Get-Process -Name "Playback V3" -ErrorAction SilentlyContinue)
$engineProcesses = @(Get-Process -Name "PlaybackEngineProbe" -ErrorAction SilentlyContinue)
$playbackProcesses = @($appProcesses) + @($engineProcesses)
$restartPaths = @($appProcesses | ForEach-Object { $_.Path } | Where-Object { $_ } | Select-Object -Unique)
try {
  if ($playbackProcesses.Count -gt 0) {
    $playbackProcesses | Stop-Process
    $playbackProcesses | Wait-Process -Timeout 10 -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 3
  }
  $resolvedManifest = (Resolve-Path -LiteralPath $ManifestPath).Path
  $mode = if ($Audible) { "--audible" } else { "--silent" }
  $duplex = if ($FullDuplex) { "--full-duplex" } else { "" }
  $arguments = "--manifest `"$resolvedManifest`" --song-index $SongIndex --type ASIO --name `"$DeviceName`" --channels 32 --sample-rate 48000 --block $BlockFrames --seconds $Seconds $mode $duplex"
  $testProcess = Start-Process -FilePath $harness -ArgumentList $arguments -NoNewWindow -PassThru
  try { $testProcess | Wait-Process -Timeout ($Seconds + 60) -ErrorAction Stop }
  catch {
    if (-not $testProcess.HasExited) { $testProcess | Stop-Process -Force }
    throw "Engine V3 test timed out; the ASIO driver may be busy or unresponsive"
  }
  if ($testProcess.ExitCode -ne 0) { throw "Engine V3 test failed with exit code $($testProcess.ExitCode)" }
}
finally {
  foreach ($restartPath in $restartPaths) { Start-Process -FilePath $restartPath -WindowStyle Hidden }
}
