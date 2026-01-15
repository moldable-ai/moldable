# System Audio Capture PRD

## Overview

System audio capture allows Moldable apps (like Meetings) to record audio output from the operating system—enabling transcription of Zoom calls, Google Meet, YouTube videos, and other audio sources without requiring invasive screen sharing prompts.

## Problem Statement

Browser-based `MediaRecorder` can only capture microphone input, not system audio. To transcribe meeting audio from apps like Zoom, we need native system audio capture capabilities.

**User expectation**: Click "record" and capture what's playing through their speakers/headphones—no screen sharing modal, no extra permissions beyond audio.

## Technical Approach

### macOS: Audio Taps API (macOS 14.2+)

Apple introduced the Audio Taps API in macOS 14.2 (Sonoma) which allows capturing system audio without screen recording permissions:

```swift
// Create a process tap to capture audio from specific apps or system-wide
let tap = try AVAudioEngine.inputNode.setManualRenderingMode(...)
```

**Requirements**:

- macOS 14.2 or later
- App must be **code-signed with a valid Apple Developer certificate**
- Entitlement: `com.apple.security.audio-recording`
- Entitlement: `com.apple.security.device.audio-input`

**Key limitation**: Ad-hoc signing (`codesign -s -`) does NOT work. The Audio Taps API requires a proper Developer ID signature from Apple's certificate authority.

### Windows: WASAPI Loopback

Windows Audio Session API (WASAPI) provides loopback capture:

```cpp
// Capture system audio via loopback device
pAudioClient->Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK, ...);
```

**Requirements**:

- Windows 10 or later
- No special signing required
- User may need to grant audio permission in Windows Settings

### Linux: PulseAudio/PipeWire

```bash
# Capture system audio via monitor source
parecord --device=alsa_output.pci-0000_00_1f.3.analog-stereo.monitor
```

## Architecture

### Current Implementation

```
┌─────────────────────────────────────────────────────────────┐
│                    Moldable Desktop (Tauri)                  │
├─────────────────────────────────────────────────────────────┤
│  Frontend (React)           │  Backend (Rust)               │
│                             │                               │
│  useSystemAudio() hook ───► │  start_audio_capture cmd      │
│    ▲                        │    │                          │
│    │ Tauri events           │    ▼                          │
│    │ (audio-capture-data)   │  Spawns sidecar binary        │
│    │                        │                               │
└────┼────────────────────────┼───────────────────────────────┘
     │                        │
     │                        ▼
     │              ┌─────────────────────┐
     │              │ moldable-audio-     │
     │              │ capture (Swift CLI) │
     │              │                     │
     │              │ - Audio Taps API    │
     │              │ - Outputs PCM/base64│
     │              │   to stdout         │
     └──────────────│                     │
                    └─────────────────────┘
```

### Files

| File                                                  | Purpose                                                     |
| ----------------------------------------------------- | ----------------------------------------------------------- |
| `desktop/src-tauri/audio-capture/`                    | Swift CLI sidecar for macOS audio capture                   |
| `desktop/src-tauri/binaries/moldable-audio-capture-*` | Compiled sidecar binaries                                   |
| `desktop/src-tauri/entitlements.mac.plist`            | macOS entitlements for audio capture                        |
| `desktop/src-tauri/src/lib.rs`                        | Tauri commands: `start_audio_capture`, `stop_audio_capture` |
| `apps/meetings/src/hooks/use-system-audio.ts`         | React hook for system audio in apps                         |

### Audio Flow

1. **Start capture**: Frontend calls `invoke('start_audio_capture', { mode, sampleRate, channels })`
2. **Sidecar spawns**: Rust backend spawns the Swift CLI binary
3. **Audio streaming**: Swift binary captures audio and outputs base64-encoded PCM chunks to stdout
4. **Event emission**: Rust backend reads stdout and emits `audio-capture-data` events
5. **Frontend receives**: React hook listens for events and passes audio to Deepgram

### Audio Format

- **Format**: Linear PCM (Int16)
- **Sample Rate**: 48000 Hz
- **Channels**: 1 (mono) or 2 (stereo)
- **Encoding**: Base64 over stdout (for IPC with sidecar)

## Signing Requirements

### Development Mode

**System audio capture does NOT work in development** because:

- `tauri dev` runs an unsigned app
- Audio Taps API requires valid Apple Developer signature
- Ad-hoc signing is rejected by the API

**Workaround**: Use microphone mode during development.

### Production Build

To enable system audio in production:

1. **Apple Developer Account** ($99/year)
2. **Developer ID Application certificate**
3. **Sign during build**:

```bash
# Sign the sidecar binary
codesign --force --sign "Developer ID Application: Your Name (TEAM_ID)" \
  --entitlements entitlements.mac.plist \
  --options runtime \
  binaries/moldable-audio-capture-aarch64-apple-darwin

# Sign the main app (Tauri handles this with notarization config)
```

4. **Notarize for distribution** (required for apps outside App Store)

### Entitlements File

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "...">
<plist version="1.0">
<dict>
    <key>com.apple.security.device.audio-input</key>
    <true/>
    <key>com.apple.security.audio-recording</key>
    <true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <key>com.apple.security.cs.disable-library-validation</key>
    <true/>
</dict>
</plist>
```

## UI/UX

### Audio Source Selection

The Meetings app shows an audio source toggle when running inside Moldable:

```
┌─────────────────────────────┐
│ Audio Source                │
│ ┌──────────┐ ┌──────────┐  │
│ │   Mic    │ │  System  │  │
│ │  ✓ ✓ ✓   │ │  (gray)  │  │
│ └──────────┘ └──────────┘  │
│                             │
│ System audio requires a     │
│ signed production build.    │
└─────────────────────────────┘
```

- **Mic**: Always available (uses browser MediaRecorder)
- **System**: Only available in signed production builds

### Error States

| State             | Message                                           |
| ----------------- | ------------------------------------------------- |
| Not in Moldable   | Audio source toggle hidden                        |
| macOS < 14.2      | "System audio requires macOS 14.2+"               |
| Unsigned build    | "System audio requires a signed production build" |
| Permission denied | "Please grant audio access in System Settings"    |

## Future Improvements

### Short-term

- [ ] Add Windows WASAPI loopback support
- [ ] Better error messages with deep links to System Settings
- [ ] Audio level visualization for system audio

### Medium-term

- [ ] Per-app audio capture (e.g., only capture Zoom, not Spotify)
- [ ] Automatic speaker diarization using system audio + mic input
- [ ] Audio mixing (system + mic for "both sides" of a call)

### Long-term

- [ ] Linux PulseAudio/PipeWire support
- [ ] Virtual audio device for more flexible routing
- [ ] Cloud-based signing service for easier distribution

## References

- [Apple Audio Taps API](https://developer.apple.com/documentation/audiotoolbox/audio_taps)
- [ScreenCaptureKit for Audio](https://developer.apple.com/documentation/screencapturekit)
- [WASAPI Loopback Recording](https://learn.microsoft.com/en-us/windows/win32/coreaudio/loopback-recording)
- [Tauri Code Signing](https://v2.tauri.app/distribute/sign/macos/)
- [Apple Notarization](https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution)
