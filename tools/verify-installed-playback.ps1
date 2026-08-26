param([string]$InstallDirectory = (Join-Path $env:LOCALAPPDATA 'Programs/Playback V3'))
$ErrorActionPreference = 'Stop'
function Get-PlaybackHash([string]$LiteralPath) {
 $stream = [IO.File]::OpenRead($LiteralPath)
 $algorithm = [Security.Cryptography.SHA256]::Create()
 try { return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
 finally { $algorithm.Dispose(); $stream.Dispose() }
}
# Read-only file checks: no audio devices, MIDI, playback, settings, or registry writes.
$installRoot = [IO.Path]::GetFullPath($InstallDirectory)
$resourcesRoot = Join-Path $installRoot 'resources'
$integrityPath = Join-Path $resourcesRoot 'release-integrity.json'
if (-not (Test-Path -LiteralPath $integrityPath)) { throw 'This installation has no release-integrity manifest. Use the complete 0.1.56 or newer installer.' }
$manifest = Get-Content -Raw -LiteralPath $integrityPath | ConvertFrom-Json
$failures = [Collections.Generic.List[string]]::new()
$archive = Join-Path $resourcesRoot 'app.asar'
if (-not (Test-Path -LiteralPath $archive)) { $failures.Add('Missing app.asar') }
elseif ((Get-PlaybackHash $archive) -ne $manifest.archiveSha256) { $failures.Add('Application programming differs from the release manifest') }
foreach ($property in $manifest.runtime.PSObject.Properties) {
 $candidate = [IO.Path]::GetFullPath((Join-Path $resourcesRoot $property.Name))
 if (-not $candidate.StartsWith($resourcesRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid dependency path in integrity manifest' }
 if (-not (Test-Path -LiteralPath $candidate)) { $failures.Add("Missing $($property.Name)"); continue }
 if ((Get-PlaybackHash $candidate) -ne $property.Value) { $failures.Add("Changed or incomplete $($property.Name)") }
}
foreach ($required in @('Playback V3.exe','ffmpeg.dll','icudtl.dat','resources.pak','locales/en-US.pak')) {
 if (-not (Test-Path -LiteralPath (Join-Path $installRoot $required))) { $failures.Add("Missing Electron file: $required") }
}
if ($failures.Count) { throw ($failures -join [Environment]::NewLine) }
"Playback $($manifest.version): application archive and all listed runtime dependencies verified."
'Audio-interface drivers, licenses, library paths, and network connections require separate setup on this PC.'
