# Product Research Notes

## Source

These notes summarize product/platform research gathered before the V3 rebuild.

The goal is not to copy another app. The goal is to understand what the market proves users expect.

## Verified Platform Notes

Loop Community Prime is available for Apple devices: Mac, iPhone, and iPad. Loop describes Prime as available on Mac, iPhone, and iPad, and Apple App Store listings show Prime compatibility for iOS/iPadOS and macOS.

MultiTracks Playback is also an Apple-platform app. MultiTracks describes Playback as compatible with macOS, iPadOS, and iOS. Their current product/system requirement pages list iOS/iPadOS and macOS support.

Audinate Dante Virtual Soundcard supports Windows and macOS. Audinate describes DVS as working as ASIO/WDM on Windows and Core Audio on macOS.

## What This Means For V3

There is a real opening for a Windows-first worship playback app that can use open WAV stems and route to Dante/ASIO reliably.

The market already teaches the workflow:

- Host device runs the playback app
- Songs are built as multitrack/stem sets
- Setlist is the live operating surface
- Tracks, click, cues, and pads need separate routing
- Operators need quick controls for play, stop, loop, jump, and panic
- Multichannel output matters
- MIDI/foot control matters
- Remote/stage control matters
- Volunteers need the UI to stay simple

But V3 should not copy another product's exact visual design, wording, icons, branding, or screen layout.

## Competitive Lessons

### Prime / Playback Style Apps

Strengths:

- Volunteer-friendly
- Fast setlist workflow
- Simple transport
- Section-based control
- Cue/pad concepts are familiar
- Mobile/tablet remote workflow is natural

Weakness for our environment:

- Apple ecosystem focus
- Windows PC with Dante is not the main target
- Closed ecosystem behavior can be limiting for custom WAV libraries

### DAWs Like Reaper, Ableton, Audacity

Strengths:

- Audio starts fast
- Audio device is already open
- Timeline is authoritative
- Waveforms are accurate
- Routing is mature
- Editing is precise

Weakness for church operators:

- More complicated than a dedicated worship playback app
- Easy to accidentally edit or arm the wrong thing
- Setlist/section/panic workflow is not purpose-built

## V3 Position

V3 should combine:

- Dedicated worship workflow from Prime/Playback-style apps
- DAW-style runtime speed and timeline accuracy
- Windows/Dante-first production routing
- Open WAV library ownership

Plain target:

**A worship playback app that feels as immediate as a DAW but operates like a dedicated church setlist tool.**

## Required Product Differences

V3 should be different from C2 in these ways:

- Live playback must not wait on library, metadata, analyzer, cache, or manifest work
- Current and next song must be armed before the operator presses Play
- Setlist export/import must carry enough prepared state for the church PC
- Dante/ASIO routing must be first-class, not an afterthought
- Remote must stay synchronized with the main app
- Dynamic click/cue/pad must be app-owned and predictable

## Copyright And Product Identity

Safe to use:

- General workflow ideas
- Common DAW concepts
- Common transport controls
- Mixer/fader concepts
- Timeline/waveform concepts
- Setlist concepts
- Routing matrix concepts

Avoid:

- Copying exact competitor screens
- Copying exact color systems
- Copying exact icons
- Copying exact labels that are distinctive to another product
- Shipping competitor screenshots
- Using competitor names/branding in the app
- Bundling competitor audio assets

V3 needs its own name, visual system, and product language.

## Sources Checked

- Loop Community Prime product page
- Apple App Store Prime listings
- MultiTracks Playback product/help pages
- Apple App Store Playback listing
- Audinate Dante Virtual Soundcard product page
