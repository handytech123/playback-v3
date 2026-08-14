# Sunday audio recovery

Playback V3 keeps Dante Virtual Soundcard open for the whole set. For DVS it requests the validated production profile automatically: ASIO, 48 kHz, 512 samples, 32 inputs and 32 outputs. DVS should remain configured for 32 x 32 channels and 10 ms Dante latency.

## What the operator sees

- **PERFORMANCE READY · AUDIO OK**: continue normally.
- **READY · AUDIO CHECK**: stop before starting the next song and open Settings > System Check for the specific cause.
- **PERFORMANCE LOCKED**: audio has stopped safely. Do not press Play until the fault is cleared.

The performance page intentionally does not show callback counters or technical clock detail. Those measurements remain in diagnostics.

## Recovery order

1. Press **Stop**.
2. Confirm the GLD and Dante network are powered and DVS is running.
3. Confirm DVS still shows 32 x 32, ASIO, and 10 ms latency.
4. In Playback, press **Clear Fault**. This closes and reopens the native engine, re-arms the current song, restores routing, and leaves transport stopped at the beginning.
5. Continue only when the badge returns to **PERFORMANCE READY · AUDIO OK**.

If Audio Check reports the wrong rate or block size, close any other ASIO client and restart Playback. Do not change DVS to 5 ms; that setting produced the incorrect half-rate callback clock on this computer.

## Before service

Open Playback after DVS and the console are online. Confirm **AUDIO OK**, select each song once if desired, and leave Playback open. Avoid closing Playback between songs because keeping the ASIO session open avoids Dante transmit-flow teardown and reconnect transients.
