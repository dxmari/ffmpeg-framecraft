# ffmpeg-framecraft – FFmpeg toolkit for 9:16 & short-form video

A Node.js-friendly FFmpeg toolkit for video processing: crop to 9:16, slice by time, add transitions between clips, subtitles, background music, and extract audio. Designed for vertical/short-form output (e.g. YouTube Shorts, TikTok, Reels) and general video pipelines.

---

## Table of contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Features](#features)
  - [Crop to 9:16](#1-crop-to-916)
  - [Slice by timestamp](#2-slice-by-timestamp)
  - [Multiple slices with transitions](#3-multiple-slices-with-transitions)
  - [Subtitles](#4-subtitles)
  - [Background music](#5-background-music)
  - [Extract thumbnail](#6-extract-thumbnail)
  - [Extract audio only](#7-extract-audio-only)
- [Pipelines (compose)](#pipelines-compose)
- [Platform presets](#platform-presets)
- [Transition presets](#transition-presets)
- [Progress reporting](#progress-reporting)
- [API reference](#api-reference)
- [Advanced: filter builders](#advanced-filter-builders)
- [License](#license)

---

## Prerequisites

**FFmpeg** and **ffprobe** must be installed:

| Platform   | Command |
|-----------|--------|
| macOS     | `brew install ffmpeg` |
| Ubuntu/Debian | `sudo apt install ffmpeg` |
| Windows   | [FFmpeg download](https://ffmpeg.org/download.html) |

If the binaries are not in `PATH`, set:

- `FFMPEG_PATH` — path to `ffmpeg`
- `FFPROBE_PATH` — path to `ffprobe`

---

## Installation

```bash
npm install ffmpeg-framecraft
```

Then:

```javascript
const { FramecraftEngine } = require('ffmpeg-framecraft');
```

---

## Quick start

```javascript
const { FramecraftEngine } = require('ffmpeg-framecraft');

const engine = new FramecraftEngine();

// Crop a landscape video to vertical 9:16
await engine.cropTo916('input.mp4', 'shorts.mp4');

// Extract one segment
await engine.slice('input.mp4', 'clip.mp4', { start: 10, end: 30 });

// Combine several segments with a fade between them
await engine.slicesWithTransitions('input.mp4', 'highlight.mp4', {
  slices: [
    { start: 0, end: 10 },
    { start: 45, end: 55 },
    { start: 120, end: 130 },
  ],
  transition: 'fade',
});
```

---

## Features

### 1. Crop to 9:16

Converts horizontal video to vertical (9:16). Uses a centered crop then scales to **720×1280** (baseline-friendly). Suited for Shorts/Reels/TikTok and similar formats.

| Parameter     | Type   | Description |
|---------------|--------|-------------|
| `inputPath`   | string | Source video path |
| `outputPath`  | string | Output path (e.g. `.mp4`) |
| `opts.onProgress` | function | `(progress) => {}`; `progress.percent` is 0–100 |

**Example**

```javascript
await engine.cropTo916('landscape.mp4', 'vertical.mp4');

await engine.cropTo916('landscape.mp4', 'vertical.mp4', {
  onProgress: (p) => console.log(`${p.percent?.toFixed(1) ?? '-'}%`),
});
```

---

### 2. Slice by timestamp

Extracts a single segment from the video. Start/end can be **seconds** or **time strings** (`"MM:SS"`, `"HH:MM:SS"`).

| Parameter   | Type   | Description |
|-------------|--------|-------------|
| `inputPath` | string | Source video |
| `outputPath`| string | Output path |
| `range`    | object | `{ start, end }` in seconds or time string |
| `opts.onProgress` | function | Optional progress callback |

**Example**

```javascript
// Seconds
await engine.slice('input.mp4', 'clip.mp4', { start: 10, end: 30 });

// Time strings
await engine.slice('input.mp4', 'clip.mp4', { start: '0:10', end: '1:30' });
await engine.slice('input.mp4', 'clip.mp4', { start: '1:00:00', end: '1:05:00' });
```

---

### 3. Multiple slices with transitions

Trims several time ranges from **one** video and concatenates them with a transition (xfade + acrossfade). Progress is based on **output** duration.

| Parameter     | Type   | Description |
|---------------|--------|-------------|
| `inputPath`   | string | Source video |
| `outputPath`  | string | Output path |
| `options.slices` | array | `[{ start, end }, ...]`; times in seconds or `"MM:SS"` |
| `options.transition` | string \| object | Preset name (e.g. `'fade'`) or `{ type, duration }` (seconds) |
| `options.preset` | string \| object | Platform preset name or object; sets default transition |
| `opts.onProgress` | function | Optional progress callback |

**Per-slice transition:** Any slice (except the first) can override the transition:

```javascript
{ start: 10, end: 20, transition: 'wipeleft' }  // only this boundary uses wipeleft
```

**Example — same transition for all boundaries**

```javascript
await engine.slicesWithTransitions('input.mp4', 'highlight.mp4', {
  slices: [
    { start: 0, end: 8 },
    { start: 20, end: 28 },
    { start: 60, end: 68 },
  ],
  transition: 'fade',
});
```

**Example — custom duration**

```javascript
await engine.slicesWithTransitions('input.mp4', 'out.mp4', {
  slices: [{ start: 0, end: 5 }, { start: 10, end: 15 }],
  transition: { type: 'dissolve', duration: 1.5 },
});
```

**Example — platform preset (transition from preset)**

```javascript
await engine.slicesWithTransitions('input.mp4', 'out.mp4', {
  slices: [{ start: 0, end: 10 }, { start: 30, end: 40 }],
  preset: 'youtubeShort',  // uses preset's transition + duration
});
```

**Example — per-slice transitions**

```javascript
await engine.slicesWithTransitions('input.mp4', 'out.mp4', {
  slices: [
    { start: 0, end: 9 },
    { start: 38, end: 62, transition: 'fadewhite', duration: 2 },
    { start: 172, end: 176.4, transition: 'dissolve', duration: 1 },
  ],
  transition: 'fade',  // default for boundaries that don't specify one
});
```

Slices are clamped to the file duration; invalid or zero-length ranges throw.

---

### 4. Subtitles

Burns an **SRT** file into the video. Optional ASS-style options for font/size/colour (useful for AI-generated captions).

| Parameter     | Type   | Description |
|---------------|--------|-------------|
| `inputPath`   | string | Source video |
| `outputPath`  | string | Output path |
| `srtPath`     | string | Path to `.srt` file |
| `opts`        | object | `onProgress` + optional style: `fontName`, `fontSize`, `primaryColour`, `outlineColour`, `backColour`, `outline`, `shadow` |

**Example**

```javascript
await engine.addSubtitles('input.mp4', 'with_subs.mp4', 'captions.srt');

await engine.addSubtitles('input.mp4', 'with_subs.mp4', 'captions.srt', {
  fontSize: 28,
  primaryColour: '&Hffffff',
  outline: 2,
  onProgress: (p) => console.log(p.percent?.toFixed(1) + '%'),
});
```

---

### 5. Background music

Mixes the video’s audio with a second audio file (e.g. music). If the video has no audio, only the music track is used.

| Parameter     | Type   | Description |
|---------------|--------|-------------|
| `inputPath`   | string | Source video |
| `outputPath`  | string | Output path |
| `musicPath`   | string | Path to music/audio (e.g. `.mp3`, `.m4a`) |
| `opts.onProgress` | function | Optional progress callback |

**Example**

```javascript
await engine.addBackgroundMusic('talk.mp4', 'with_music.mp4', 'background.mp3');
```

---

### 6. Extract thumbnail

Exports a single frame as an image. Format is taken from the file extension (`.jpg`, `.png`).

| Parameter     | Type   | Description |
|---------------|--------|-------------|
| `inputPath`   | string | Source video |
| `outputPath`  | string | Output image path (e.g. `frame.jpg`, `poster.png`) |
| `time`        | number \| string | Time in seconds or `"MM:SS"` / `"HH:MM:SS"` (default: 0) |

**Example**

```javascript
await engine.extractThumbnail('input.mp4', 'frame.jpg', 5);
await engine.extractThumbnail('input.mp4', 'poster.png', '0:01:30');
```

---

### 7. Extract audio only

Re-encodes audio to **AAC** (`.m4a`) or **MP3** (`.mp3`) based on the output extension. No video stream.

| Parameter     | Type   | Description |
|---------------|--------|-------------|
| `inputPath`   | string | Source video |
| `outputPath`  | string | Output path (`.m4a` or `.mp3`) |
| `opts.bitrate`| number | kbps (default: 256 for AAC, 320 for MP3) |
| `opts.sampleRate` | number | Hz (default: 48000) |
| `opts.onProgress` | function | Optional progress callback |

**Example**

```javascript
await engine.extractAudioOnly('video.mp4', 'audio.m4a');
await engine.extractAudioOnly('video.mp4', 'audio.mp3');
await engine.extractAudioOnly('video.mp4', 'audio.mp3', { bitrate: 256 });
```

---

## Pipelines (compose)

Run several operations in sequence with a single call. Intermediate files are written to the same directory as the final output and **deleted** after the pipeline finishes.

**Preset:** one named operation.

```javascript
await engine.compose('input.mp4', 'output.mp4', 'shorts');
// Same as: cropTo916(input, output)
```

**Pipeline:** array of steps. Each step has an `op` and step-specific options.

| Step `op` | Required options | Description |
|-----------|------------------|-------------|
| `crop916` | — | Crop to 9:16 |
| `slice`   | `start`, `end`   | Extract segment |
| `subtitles` | `srtPath`      | Burn SRT |
| `music`   | `musicPath`      | Add background music |
| `slicesWithTransitions` | `slices` | Multiple slices + transitions; optional `transition`, `preset` |
| `audioOnly` | `outputPath`   | Extract audio to given path (no video output file from compose) |

**Example — crop then slice**

```javascript
await engine.compose('input.mp4', 'output.mp4', [
  { op: 'crop916' },
  { op: 'slice', start: 0, end: 60 },
]);
```

**Example — slice then extract audio only**

```javascript
await engine.compose('input.mp4', 'output.mp4', [
  { op: 'slice', start: 10, end: 20 },
  { op: 'audioOnly', outputPath: path.join(__dirname, 'data', 'clip_audio.mp3') },
], { onProgress: (p) => console.log(p.percent?.toFixed(1) + '%') });
// Only clip_audio.mp3 is kept; intermediate slice file is removed.
```

**Example — full pipeline**

```javascript
await engine.compose('input.mp4', 'output.mp4', [
  { op: 'slicesWithTransitions', slices: [{ start: 0, end: 10 }, { start: 30, end: 40 }], preset: 'youtubeShort' },
  { op: 'subtitles', srtPath: 'subs.srt' },
  { op: 'music', musicPath: 'bgm.mp3' },
], { onProgress: (p) => console.log(p.percent?.toFixed(1) + '%') });
```

---

## Platform presets

Presets define aspect ratio, resolution, transition, and codec hints. Use **preset name** (string) or the **object** from the package.

| Preset               | Name             | Notes |
|----------------------|------------------|--------|
| YouTube Shorts       | `youtubeShort`   | 9:16, 1080×1920, fade, subtitles/watermark flags |
| TikTok               | `tiktok`         | 9:16, 1080×1920, fade |
| Instagram Reels      | `instagramReels` | 9:16, 1080×1920, dissolve |
| Shorts (720p)        | `shorts`         | 9:16, 720×1280, baseline profile |

**Example**

```javascript
const { youtubeShortPreset, getPreset } = require('ffmpeg-framecraft');

console.log(youtubeShortPreset.transition);  // 'fade'
console.log(getPreset('tiktok').aspectRatio); // '9:16'

await engine.slicesWithTransitions('input.mp4', 'out.mp4', {
  slices: [...],
  preset: 'youtubeShort',
});
```

---

## Transition presets

Used by `slicesWithTransitions`. You can pass a **preset name** or **`{ type, duration }`** (duration in seconds).

**Available names:**  
`fade`, `fadeLong`, `wipeleft`, `wiperight`, `wipeup`, `wipedown`, `slideleft`, `slideright`, `slideup`, `slidedown`, `circleopen`, `circleclose`, `rectcrop`, `distance`, `fadeblack`, `fadewhite`, `radial`, `dissolve`, `pixelize`, `zoomin`, `zoomout`.

**Example**

```javascript
const { TRANSITION_PRESETS, getTransition } = require('ffmpeg-framecraft');

// Preset name
transition: 'dissolve'

// Custom type + duration
transition: { type: 'fade', duration: 1 }

// Resolve preset to object
getTransition('fadeLong');  // { type: 'fade', duration: 1 }
```

Transition duration is automatically clamped so it does not exceed the length of either segment at that boundary.

---

## Progress reporting

All operations that take `opts.onProgress` report:

- **`percent`** — 0–100, based on **output** duration when known (slice, slicesWithTransitions, cropTo916, addBackgroundMusic). Otherwise from FFmpeg input duration.
- **`timemark`** — current output time (e.g. `"0:00:12.50"`).
- **`frames`**, **`currentFps`**, **`currentKbps`** when available.

On completion, the executor emits a final `onProgress({ percent: 100 })` so the UI can show 100% before “Compose completed”.

---

## API reference

| Method | Description |
|--------|-------------|
| `cropTo916(inputPath, outputPath, opts?)` | Crop to 720×1280 vertical (9:16). |
| `slice(inputPath, outputPath, { start, end }, opts?)` | Extract one segment; start/end in seconds or time string. |
| `addSubtitles(inputPath, outputPath, srtPath, opts?)` | Burn SRT; optional ASS style options. |
| `extractThumbnail(inputPath, outputPath, time?)` | Single frame to image (.jpg / .png). |
| `addBackgroundMusic(inputPath, outputPath, musicPath, opts?)` | Mix video audio with music. |
| `extractAudioOnly(inputPath, outputPath, opts?)` | Audio only → .m4a (AAC) or .mp3. |
| `slicesWithTransitions(inputPath, outputPath, { slices, transition?, preset? }, opts?)` | Multiple slices joined with xfade/acrossfade. |
| `compose(inputPath, outputPath, pipeline?, opts?)` | Run preset `'shorts'` or pipeline array. |

**Common `opts`:** `onProgress: (progress) => {}`.

---

## Advanced: filter builders

For tests or custom FFmpeg graphs you can use the low-level filter helpers.

```javascript
const {
  cropTo916Filter,
  subtitleFilter,
  amixFilter,
  buildSlicesWithTransitionsFilter,
  SHORTS_WIDTH,
  SHORTS_HEIGHT,
} = require('ffmpeg-framecraft');

// Build -vf style filter strings (no execution)
cropTo916Filter(1920, 1080);
// => "crop=607:1080:656:0,scale=720:1280"

subtitleFilter('/path/to/subs.srt', { fontSize: 24 });
// => "subtitles='...':force_style='FontSize=24'"

amixFilter(true);
// => "[0:a][1:a]amix=inputs=2:duration=shortest[aout]"

// Slices + transitions: pass normalized slices and hasAudio
const slices = [
  { startSeconds: 0, endSeconds: 10, transition: null },
  { startSeconds: 20, endSeconds: 30, transition: { type: 'fade', duration: 0.5 } },
];
const { filterComplex, mapVideo, mapAudio } = buildSlicesWithTransitionsFilter(slices, true);
// Use filterComplex with -filter_complex and mapVideo/mapAudio with -map
```

---

## License
ISC License

Copyright (c) 2025, the ffmpeg-framecraft contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.