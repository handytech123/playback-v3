$ErrorActionPreference = "Stop"
$workspace = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $workspace "vendor\runtime"
$downloads = Join-Path $workspace "vendor\downloads"
New-Item -ItemType Directory -Force -Path $runtime, $downloads | Out-Null

$ffmpeg = Get-Command ffmpeg -ErrorAction Stop
$filters = & $ffmpeg.Source -hide_banner -filters 2>&1 | Out-String
if ($filters -notmatch "rubberband") {
    throw "The detected FFmpeg build does not include the rubberband filter."
}
$ffmpegRoot = Split-Path -Parent (Split-Path -Parent $ffmpeg.Source)
Copy-Item -LiteralPath $ffmpeg.Source -Destination (Join-Path $runtime "ffmpeg.exe") -Force
Copy-Item -LiteralPath (Join-Path $ffmpegRoot "LICENSE") -Destination (Join-Path $runtime "FFMPEG-LICENSE.txt") -Force
Copy-Item -LiteralPath (Join-Path $ffmpegRoot "README.txt") -Destination (Join-Path $runtime "FFMPEG-README.txt") -Force

$rubberUrl = "https://breakfastquay.com/files/releases/rubberband-4.0.0-gpl-executable-windows.zip"
$rubberZip = Join-Path $downloads "rubberband-4.0.0-gpl-executable-windows.zip"
$rubberExtract = Join-Path $downloads "rubberband-4.0.0"
if (-not (Test-Path -LiteralPath $rubberZip)) {
    Invoke-WebRequest -Uri $rubberUrl -OutFile $rubberZip
}
# Do not recursively delete an existing runtime preparation folder.
Expand-Archive -LiteralPath $rubberZip -DestinationPath $rubberExtract -Force
$rubberExe = Get-ChildItem -LiteralPath $rubberExtract -Recurse -File -Filter "rubberband.exe" | Select-Object -First 1
if (-not $rubberExe) { throw "The official Rubber Band archive did not contain rubberband.exe." }
Copy-Item -LiteralPath $rubberExe.FullName -Destination (Join-Path $runtime "rubberband.exe") -Force
$sndfile = Get-ChildItem -LiteralPath $rubberExtract -Recurse -File -Filter 'sndfile.dll' | Select-Object -First 1
if (-not $sndfile) { throw 'Rubber Band requires sndfile.dll; installer preparation is incomplete.' }
Copy-Item -LiteralPath $sndfile.FullName -Destination (Join-Path $runtime 'sndfile.dll') -Force
$rubberLicense = Get-ChildItem -LiteralPath $rubberExtract -Recurse -File | Where-Object { $_.Name -match '^(COPYING|LICENSE)(\.|$)' } | Select-Object -First 1
if ($rubberLicense) { Copy-Item -LiteralPath $rubberLicense.FullName -Destination (Join-Path $runtime "RUBBERBAND-LICENSE.txt") -Force }

& (Join-Path $runtime "ffmpeg.exe") -hide_banner -version | Select-Object -First 1
& (Join-Path $runtime "rubberband.exe") --version
