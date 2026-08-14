# Native engine probe

The replacement engine is developed separately in `engine/` as the
`PlaybackEngineCore` library. See the Phase 1–3 engine documents under `docs/`.
The probe remains the working playback implementation and migration fallback.

This probe isolates the Milestone 1 audio path from the web UI. It opens the
default output device once, arms every cached stem in a confirmed-set manifest,
and accepts transport commands without scanning or preparation.

JUCE is pinned locally at `external/JUCE` to tag `8.0.15` for the current
prototype. Product licensing must be resolved before distributing a closed-source
commercial build.

