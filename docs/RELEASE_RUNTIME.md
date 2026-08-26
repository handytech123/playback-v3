# Preserving the field-tested church-PC release

The church PC accumulated tested fixes to compiled application modules and its
renderer, in addition to typed/native source edits. A plain TypeScript/Vite build
would omit several of those fixes. `release-runtime/` is an explicit, tracked
release bridge: it contains the exact working JavaScript and renderer files,
including the GLD recall modules/panel, ProPresenter changes, IEM behavior,
readiness policy, audio-device refresh, editor layout, and Safari remote support.
Unchanged modules continue to compile from source.

The postbuild hooks install these files into the package staging directories.
Every preserved file has a SHA-256 integrity check. Source hashes deliberately
make builds FAIL if source changes without reconciling the bridge; it cannot
silently discard later edits. Source changes should migrate the corresponding
preserved implementation into typed source, verify behavior, then remove that
override and update the guard manifest. Do not simply recapture hashes to bypass
an unexplained difference. This bridge is not a separate app or a dependency on
the church PC; all files are in Git and embedded in the installer.

Native engine source, headers, and tests are committed normally and rebuilt with
CMake. Runtime binaries in vendor are verified before packaging and copied into
the installer. No user settings, songs, saved mixes, tokens, or machine-specific
ASIO configuration are included in this programming snapshot.
