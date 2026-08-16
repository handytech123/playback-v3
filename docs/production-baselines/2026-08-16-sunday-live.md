# Playback V3 Production Baseline — 2026-08-16

## Acceptance result

Playback V3 completed the full Sunday worship set live without a reported playback failure, audio-engine crash, Dante interruption, transport failure, song-transition failure, or required recovery action.

This is the first known-good live-production baseline. Changes after this point must preserve this behavior and pass the relevant regression suite before replacing it.

## Application

- Version: `0.1.39`
- Installer: `C:\PlaybackV3\release\Playback-V3-Setup-0.1.39.exe`
- Installer SHA-256: `1D8344DE76D3E783D4F7AA6CDFF643ABFFF4CEADCEFFA9B1C784C5D50D1A7D42`
- Installed package verified from: `C:\Users\User\AppData\Local\Programs\Playback V3\resources\app.asar`

## Live confirmed set

- Set: `Sunday Set`
- ID: `confirmed-sunday-set-1786885227902`
- Confirmed: `2026-08-16 08:02:54 America/Chicago`
- Manifest: `C:\Users\User\AppData\Roaming\playback-v3\.playback-cache\confirmed-sets\confirmed-sunday-set-1786885227902\confirmed-set.json`
- Manifest SHA-256: `92CA14A2F35F2776ECC23BD7D85CB716B0A927B4C17F70669D2F84AC3B720B56`

| Order | Song | Arrangement | Key | BPM | Stems | Auto level |
|---:|---|---|---:|---:|---:|---:|
| 1 | No One Higher | No One Higher - Bb - 72 BPM | Bb | 72 | 11 | -3.39 dB |
| 2 | Holy Forever | Holy Forever - G - 72 BPM | G | 72 | 11 | -0.09 dB |
| 3 | Forever Reign | Forever Reign - B - 83 BPM | B | 83 | 9 | -0.34 dB |
| 4 | Blessed Assurance | REAPER · Blessed Assurance Abridged | G | 68.5 | 14 | -0.95 dB |

## Runtime configuration fingerprints

- Device settings SHA-256: `A5504D485C0F9032DB2F69E3CE1ADF974EF5FC333E8A08C28ACC1ACC84A8ECD0`
- Draft setlist SHA-256: `E9A1080C04FF40680947D0132B6E774ED78BA5664DFE008F9A1BE9D7918BFEDB`
- Audio device: Dante Virtual Soundcard ASIO, 48 kHz, 512 samples
- Routing model: song stem → named bus → locked global matrix → Dante output

## Known non-blocking follow-up

The generated click can sound a few milliseconds ahead of some rendered stems, most noticeably on No One Higher. Reaper plays the vendor click with the vendor stems, while Playback generates its click from the mathematical grid. Source-click offset measurement and Rubber Band latency compensation remain a refinement; they were not a live-production blocker for this baseline.

## Baseline rule

Keep this installer and confirmed-set cache intact. Do not overwrite this record when validating later builds. A later build becomes the production baseline only after it completes an equivalent live set successfully.
