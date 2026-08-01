# Native engine probe

This probe isolates the Milestone 1 audio path from the web UI. It opens the
default output device once, arms every cached stem in a confirmed-set manifest,
and accepts transport commands without scanning or preparation.

JUCE is pinned locally at `external/JUCE` to tag `8.0.15` for the current
prototype. Product licensing must be resolved before distributing a closed-source
commercial build.

