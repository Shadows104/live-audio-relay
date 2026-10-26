# Changelog

All notable changes to Live Audio Relay. Targets Foundry VTT v14.

## [0.1.0] - Unreleased

### Added
- GM control panel, opened from the Ambient Sound controls (broadcast tower icon).
  - Mix several sources into one stream, for example a YouTube tab and Pocket Bard through BlackHole. Players receive a single track, so adding sources doesn't use more upload.
  - Sources: a browser tab, a window or the whole screen with its audio, or any audio input such as a virtual cable (BlackHole, VB-Cable) or a PipeWire/PulseAudio monitor. Tabs and screens can be added more than once; each device only once.
  - Each source has a level meter, a volume slider, mute and remove. Volume and mute are remembered per device.
  - A limiter on the mix stops several loud sources from clipping.
  - "Hear the mix" plays the finished mix on the GM's speakers at the GM's live audio volume, so sources routed into a virtual cable can be heard too. Muting a shared tab in the browser keeps its sound in the stream.
  - Sources can be added and removed while live without reconnecting players. Stopping a share from the browser's "Stop sharing" bar removes just that source.
  - Stopping the stream keeps the mix, so you can go live again without re-sharing.
  - The last picked source type is remembered between sessions. The refresh button asks for microphone access so device names show up.
  - While live, shows each connected player and their connection state.
  - Warns when tab sharing can't work here: in Foundry's desktop app, or in Safari or Firefox, which can't share tab audio. Audio devices still work there.
- Audio streams from the GM to each player over WebRTC, using Foundry's socket only to set up connections.
  - Stereo Opus at a music bitrate (96–256 kbps, world setting) with the browser's voice processing turned off.
  - Players who join mid-session connect automatically. Dropped connections retry up to 3 times.
- Only GMs can stream. If a second GM goes live, the first GM's stream stops.
- Player headphones toggle in the Token controls to mute or unmute the stream.
- Settings: listen and volume (per client; volume is also scaled by Foundry's Music volume), stream quality and ICE servers (world).
