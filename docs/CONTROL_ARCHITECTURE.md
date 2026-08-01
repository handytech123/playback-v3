# V3 Control Architecture

## Purpose

V3 needs a serious control layer.

The app should not only play tracks. It should be able to sit in the middle of the worship tech system and coordinate:

- Playback transport
- Stage remote control
- ProPresenter slide commands
- Mixer fader/control commands
- Panic/recovery commands
- Loop, jump, and skip commands

The control layer must be fast, predictable, and separated from audio preparation.

## Core Decision

V3 should use a command bus internally.

Every outside control source should become a normalized app command before it touches playback.

Every outgoing control action should come from the same command/event system.

```text
Remote / OSC / MIDI / UI / Footswitch
  -> V3 Command Bus
  -> Live Engine / ProPresenter / Mixer / Remote State
```

This prevents each feature from inventing its own path.

## Why OSC Matters

OSC is a good fit for the V3 remote because it is network-native and easy to map.

Good uses:

- Remote play
- Remote stop
- Remote panic
- Remote loop
- Remote jump to region
- Remote selected song
- Remote current time
- Remote current region
- Remote mixer changes

OSC should control V3.

V3 should also broadcast state over OSC/WebSocket so the remote stays visually synchronized.

## Why MIDI Still Matters

MIDI is still important for production integration.

Good uses:

- ProPresenter next slide
- ProPresenter previous slide
- ProPresenter cue/trigger commands
- Foot controllers
- Hardware controllers
- Mixer control where the console expects MIDI-style messages

MIDI should not be the only internal language. It should be an adapter at the edge of the system.

## GLD-112 Control

The Allen & Heath GLD family supports MIDI control and TCP/IP control using MIDI-format messages.

V3 should support a GLD adapter with a clear profile:

- Mixer model: GLD-112
- Connection mode: TCP/IP or MIDI port
- Default TCP port: `51325`
- MIDI channel must match the GLD MIDI setup screen
- Commands are hex/MIDI message based

Potential GLD controls:

- Fader levels
- Mutes
- DCA control
- Scene recall
- Mix/master levels
- Transport/MIDI machine control if useful

V3 should not hardcode one church's board mapping into the core app.

Instead:

```text
V3 Mixer Intent
  -> Control Profile
  -> GLD-112 Hex/MIDI Message
  -> Board
```

Example intents:

- `setFader(track: "Dynamic Cue", value: 0.75)`
- `muteChannel(channel: 12, muted: true)`
- `recallScene(scene: 4)`
- `setDcaLevel(dca: 1, value: 0.82)`

The profile decides the exact GLD message.

## Important GLD Warning

The GLD control protocol is powerful but lower-level than OSC.

V3 should include a test/learn mode before sending live commands:

- Connect to board
- Send harmless ping/status if available
- Confirm MIDI channel
- Confirm target channel
- Test one fader
- Test one mute
- Store mapping only after confirmation

No live board-control feature should ship without a safe test screen.

## GLD Scene Recall Lesson From C2/Previous Testing

The earlier scene-based workflow was useful proof, but it should not be the main V3 strategy.

That workflow was:

- Build board scenes per song
- Let the song recall the scene
- Add track channels into that scene
- Repeat that setup for many songs

That becomes hard to maintain at scale. For 60 songs, the board itself becomes a second song database.

Problems with that approach:

- Every song needs board scene programming
- Scene state can drift from app state
- Recall IDs and scene numbers can be easy to mis-map
- A missing or changed scene can break a song
- Scene recall can affect more mixer state than intended
- MIDI/channel/bank/program setup becomes fragile
- Middleware such as Allen & Heath MIDI Control can introduce another failure point

V3 should avoid making board scenes the normal per-song automation mechanism.

Better V3 strategy:

- Use scenes only for broad service-level snapshots when needed
- Use app-controlled mixer intents for track-related changes
- Send only the specific board changes needed
- Keep the app as the source of truth for song/setlist state
- Include a GLD test/learn screen before live use

Example:

```text
Song selected
  -> app knows required track buses
  -> app sends only needed GLD fader/mute/DCA changes
  -> board does not need a unique scene for every song
```

This is more DAW-like and more maintainable.

## Allen & Heath MIDI Control Caution

Allen & Heath MIDI Control can be useful, but V3 should not depend on it as the only reliable path for GLD control.

Known risk areas:

- Virtual MIDI port routing
- DAW/HUI/Mackie translation mode
- Direct USB MIDI and translated virtual MIDI both being enabled at the same time
- Windows MIDI service/device enumeration changes
- MIDI channel mismatch between computer and mixer
- Bank/program off-by-one mistakes for scene recall
- NRPN/fader message complexity

For V3, preferred GLD path:

```text
V3 GLD Adapter
  -> direct TCP/IP MIDI-format messages
  -> GLD network port
```

Use Allen & Heath MIDI Control only as an optional compatibility route, not as the core architecture.

## ProPresenter Control

V3 should include built-in MIDI output for ProPresenter.

Minimum:

- Enable/disable ProPresenter MIDI
- Choose MIDI output device
- Choose MIDI channel
- Configure next slide command
- Configure previous slide command
- Configure optional section/song cues

Playback events can trigger slide commands:

- Song start
- Region start
- Cue marker
- Manual operator button
- End of song

These should be optional per set/song.

## Remote Control

The V3 remote should be able to control the live performance confidently.

The remote should support:

- Play
- Pause
- Stop
- Panic
- Exit panic
- Loop current region continuously
- Loop current region
- Go on
- Jump to region
- Cue Next
- Current song selection
- Current setlist display
- Current timeline position
- Current region highlight

OSC can be the control protocol, but the visual state may still use WebSocket if that is better for UI sync.

The rule:

**Commands must be low-latency. Visual updates must be accurate.**

## Control Surfaces Are Not Audio

Board control, OSC, and MIDI must not sit inside the audio processing path.

They should be scheduled against the same transport clock, but they should not block audio.

If a board command fails:

- Audio keeps playing
- Operator gets a warning
- App does not freeze

## Command Timing

V3 needs two kinds of commands:

### Immediate Commands

These happen now:

- Play
- Pause
- Stop
- Panic
- Mixer fader move
- Pad on/off

### Musical Commands

These are requested now but execute on a safe boundary:

- Loop region
- Loop and future Repeat Once say `Repeat` two beats before the destination section cue.
- Loop cancellation is accepted only before the `Repeat` cue; afterward the transition is locked through the boundary.
- A timely Loop cancellation restores the normal cue lane so the upcoming section is still announced.
- Jump region
- Exit panic recovery
- Cue next song
- Section-based MIDI/slide cues

The command bus must know the difference.

## V3 Implementation Shape

Recommended modules:

```text
src/control/command-bus
src/control/osc-server
src/control/midi-output
src/control/midi-input
src/control/pro-presenter
src/control/mixers/gld112
src/control/control-profiles
```

The audio engine should expose timing state to the command bus:

- current song
- current time
- current measure/beat
- current region
- next region
- panic state
- loop state

The command bus decides what external messages should fire.

## Decision For V3

Yes, V3 should be designed around OSC and MIDI from the start.

But it should be designed as adapters around one internal command system.

That gives us:

- One app truth
- One timing clock
- One remote command model
- ProPresenter integration
- GLD-112 integration
- Future board/control support without rewriting playback
