param(
  [Parameter(Mandatory = $true)][int]$ProcessId,
  [Parameter(Mandatory = $true)][string]$OutputPath
)

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class PlaybackWindowCapture {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);
}
"@

$process = Get-Process -Id $ProcessId -ErrorAction Stop
$handle = $process.MainWindowHandle
if ($handle -eq [IntPtr]::Zero) { throw "Process $ProcessId has no main window" }
$rect = New-Object PlaybackWindowCapture+RECT
if (-not [PlaybackWindowCapture]::GetWindowRect($handle, [ref]$rect)) { throw "Could not read window bounds" }
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
$bitmap = New-Object System.Drawing.Bitmap $width, $height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try {
  $hdc = $graphics.GetHdc()
  try {
    if (-not [PlaybackWindowCapture]::PrintWindow($handle, $hdc, 2)) { throw "PrintWindow failed" }
  } finally { $graphics.ReleaseHdc($hdc) }
  $fullPath = [System.IO.Path]::GetFullPath($OutputPath)
  [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($fullPath)) | Out-Null
  $bitmap.Save($fullPath, [System.Drawing.Imaging.ImageFormat]::Png)
  Write-Output $fullPath
} finally {
  $graphics.Dispose()
  $bitmap.Dispose()
}
