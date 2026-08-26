# Release hardening follow-up

After distributing 0.1.56, added build and installation checks without changing
the live application's audio behavior or the distributed setup executable:

- Verify all staged programming files, not only the 19 preserved overrides.
- Verify renderer entry points reference existing local packaged assets.
- Validate an entire override group before replacing any build output.
- Reject unknown groups and paths that could write outside the build directories.
- Test source guard behavior with both LF and Windows CRLF checkouts.
- Add a read-only PowerShell checker for another PC, requiring no Node/Python.
  It checks app.asar and bundled dependencies against the embedded integrity
  manifest and checks essential Electron files. It never starts playback or
  opens hardware.

The existing extracted 0.1.56 installer passes the stronger programming and
runtime checks. Negative tests cover corrupt/missing dependencies, missing code,
broken UI assets, source drift, and partial override updates. The diagnostic
script is distributed next to the installer as `Verify-Playback.ps1`.

Run on the destination PC after installation:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Verify-Playback.ps1
```

For a custom install location, add `-InstallDirectory 'C:\Path\Playback V3'`.
Driver compatibility, permissions, licenses, library configuration, and hardware
audio checks remain separate from file integrity. No clean-machine/VM hardware
test is claimed.
