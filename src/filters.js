const path = require('path');

/** @constant {number} Shorts target width (default / 1080p) */
const SHORTS_WIDTH = 1080;
/** @constant {number} Shorts target height (default / 1080p) */
const SHORTS_HEIGHT = 1920;

/** 9:16 vertical resolutions: 'light' = 406×720, '720' = 720×1280, '1080' = 1080×1920 (recommended) */
const VERTICAL_RESOLUTIONS = { light: [406, 720], '720': [720, 1280], '1080': [1080, 1920] };

function getVerticalSize(resolution) {
  const r = VERTICAL_RESOLUTIONS[resolution] ? resolution : '1080';
  const [w, h] = VERTICAL_RESOLUTIONS[r];
  return { width: w, height: h };
}

/**
 * Build FFmpeg -vf filter string for 9:16 vertical crop (Shorts/TikTok format).
 * Crops centered 9:16 region from source, then scales to target size (default 1080×1920).
 *
 * @param {number} width - Source video width
 * @param {number} height - Source video height
 * @param {{ width: number, height: number }} [target] - Output size (default 1080×1920)
 * @returns {string} FFmpeg video filter string (crop,scale)
 */
function cropTo916Filter(width, height, target) {
  const { width: outW, height: outH } = target || getVerticalSize('1080');
  const cropWidth = Math.floor((height * 9) / 16);
  const cropHeight = height;
  const x = Math.floor((width - cropWidth) / 2);
  const y = 0;

  const crop = `crop=${cropWidth}:${cropHeight}:${x}:${y}`;
  const scale = `scale=${outW}:${outH}`;

  return `${crop},${scale}`;
}

/**
 * Build FFmpeg -vf filter string for content-aware crop using time-based keyframes.
 * This supports both TRACK and LETTERBOX modes; output is scale+pad to target size (default 1080×1920).
 *
 * @param {number} width - Source video width
 * @param {number} height - Source video height
 * @param {Array<{ t: number, x: number, w?: number }>} keyframes - Sorted keyframes in seconds; w is crop width in pixels
 * @param {{ width: number, height: number }} [target] - Output size (default 1080×1920)
 * @returns {string} FFmpeg video filter string
 */
function cropTo916DynamicFilter(width, height, keyframes, target) {
  const { width: outW, height: outH } = target || getVerticalSize('1080');

  if (!Array.isArray(keyframes) || keyframes.length === 0) {
    return cropTo916Filter(width, height, target);
  }

  const cropWidthRaw = Math.floor((height * 9) / 16);
  const cropWidth = cropWidthRaw - (cropWidthRaw % 2);
  const maxX = Math.max(0, width - cropWidth);
  const widthEven = width - (width % 2);

  const frames = [...keyframes]
    .filter((k) => k && Number.isFinite(k.t) && Number.isFinite(k.x))
    .sort((a, b) => a.t - b.t)
    .map((k) => {
      let w = Number.isFinite(k.w) ? k.w : cropWidth;
      w = Math.min(widthEven, Math.max(cropWidth, w));
      w = w - (w % 2);
      let xVal = Math.max(0, Math.min(maxX, k.x));
      if (xVal + w > widthEven) xVal = Math.max(0, widthEven - w);
      xVal = xVal - (xVal % 2);
      return {
        t: Math.max(0, k.t),
        x: xVal,
        w,
      };
    });

  if (frames.length === 0) {
    return cropTo916Filter(width, height, target);
  }

  // Piecewise-constant x(t): hold each segment's x until next keyframe (matches AutoCrop scene-based crop).
  // Keep x even for encoder friendliness: 2*trunc(x/2)
  let xExpr = `${frames[frames.length - 1].x}`;
  for (let i = frames.length - 2; i >= 0; i--) {
    const t0 = frames[i].t;
    const t1 = frames[i + 1].t;
    const x0 = frames[i].x;

    if (t1 <= t0 + 1e-6) {
      xExpr = `${x0}`;
      continue;
    }

    xExpr = `if(between(t\\,${t0}\\,${t1})\\,${x0}\\,${xExpr})`;
  }
  xExpr = `2*trunc((${xExpr})/2)`;

  // Piecewise-step w(t): hold each segment's width until next keyframe.
  // Keep width even.
  let wExpr = `${frames[frames.length - 1].w}`;
  for (let i = frames.length - 2; i >= 0; i--) {
    const t0 = frames[i].t;
    const t1 = frames[i + 1].t;
    const w0 = frames[i].w;
    wExpr = `if(between(t\\,${t0}\\,${t1})\\,${w0}\\,${wExpr})`;
  }
  wExpr = `2*trunc((${wExpr})/2)`;

  // When w >= src width, force x=0 to avoid invalid crop.
  const safeXExpr = `if(gte(${wExpr}\\,${width})\\,0\\,${xExpr})`;

  const crop = `crop=w='${wExpr}':h=ih:x='${safeXExpr}':y=0`;
  const scale = `scale=${outW}:${outH}:force_original_aspect_ratio=decrease:force_divisible_by=2`;
  const pad = `pad=${outW}:${outH}:(ow-iw)/2:(oh-ih)/2`;
  return `${crop},${scale},${pad}`;
}

/**
 * Build FFmpeg subtitles filter string.
 * Escape special characters in path for FFmpeg (colons, backslashes).
 *
 * @param {string} srtPath - Path to SRT subtitle file
 * @param {object} [style] - Optional ASS force_style for future AI caption styling
 * @param {string} [style.fontName] - Font name
 * @param {string} [style.fontSize] - Font size
 * @param {string} [style.primaryColour] - Primary colour (ASS format)
 * @param {string} [style.outlineColour] - Outline colour
 * @param {string} [style.backColour] - Background colour
 * @param {number} [style.outline] - Outline thickness
 * @param {number} [style.shadow] - Shadow depth
 * @returns {string} FFmpeg subtitles filter string
 */
function subtitleFilter(srtPath, style = {}) {
  const absPath = path.resolve(srtPath);
  const escaped = absPath.replace(/\\/g, '\\\\').replace(/:/g, '\\:');

  let filter = `subtitles='${escaped}'`;

  const styleParts = [];
  if (style.fontName) styleParts.push(`FontName=${style.fontName}`);
  if (style.fontSize) styleParts.push(`FontSize=${style.fontSize}`);
  if (style.primaryColour) styleParts.push(`PrimaryColour=${style.primaryColour}`);
  if (style.outlineColour) styleParts.push(`OutlineColour=${style.outlineColour}`);
  if (style.backColour) styleParts.push(`BackColour=${style.backColour}`);
  if (style.outline !== undefined) styleParts.push(`Outline=${style.outline}`);
  if (style.shadow !== undefined) styleParts.push(`Shadow=${style.shadow}`);

  if (styleParts.length > 0) {
    filter += `:force_style='${styleParts.join(',')}'`;
  }

  return filter;
}

/**
 * Build FFmpeg -filter_complex string for mixing video with background music.
 * Video keeps original stream; audio is mix of video audio + music.
 *
 * @param {boolean} [videoHasAudio=true] - Whether source video has audio track
 * @returns {string} FFmpeg filter_complex string
 */
function amixFilter(videoHasAudio = true) {
  if (videoHasAudio) {
    return '[0:a][1:a]amix=inputs=2:duration=shortest[aout]';
  }
  return '[1:a]anull[aout]';
}

/**
 * Build -filter_complex for multiple slices from one input with xfade/acrossfade transitions.
 * Slices are applied to the same input (trim each range, then chain xfade/acrossfade).
 *
 * When transitionDummyHold > 0, at each boundary we add a short "dummy" segment (frozen last frame
 * of prev slice, frozen first frame of next slice) so the xfade happens over the freeze instead of
 * over the live cut—smoother transition and avoids overlapping the actual cuts.
 *
 * @param {Array<{ startSeconds: number, endSeconds: number, transition?: { type: string, duration: number } }>} slices
 *        Normalized slice ranges in seconds, with optional per-slice transition (for slice i > 0).
 * @param {boolean} hasAudio - Whether input has audio (to include acrossfade)
 * @param {{ transitionDummyHold?: number }} [opts] - Optional. transitionDummyHold: seconds of frozen frame at each boundary (default 0). Use ~1 for smoother transitions.
 * @returns {{ filterComplex: string, mapVideo: string, mapAudio: string | null }}
 */
function buildSlicesWithTransitionsFilter(slices, hasAudio = true, opts = {}) {
  const dummyHold = Math.max(0, Number(opts.transitionDummyHold) || 0);
  const eps = 0.034; // ~1 frame at 30fps for freeze extraction

  if (!slices.length) throw new Error('slices must have at least one range');

  const parts = [];
  const durations = [];

  for (let i = 0; i < slices.length; i++) {
    const { startSeconds, endSeconds } = slices[i];
    const d = endSeconds - startSeconds;
    durations.push(d);

    if (dummyHold <= 0 || d <= dummyHold + eps) {
      // No dummy: same as before
      parts.push(
        `[0:v]trim=start=${startSeconds}:end=${endSeconds},setpts=PTS-STARTPTS[v${i}]`
      );
      if (hasAudio) {
        parts.push(
          `[0:a]atrim=start=${startSeconds}:end=${endSeconds},asetpts=PTS-STARTPTS[a${i}]`
        );
      }
      continue;
    }

    // With dummy hold: segment = [optional freeze head] + content + [optional freeze tail]
    const hasPrev = i > 0;
    const hasNext = i < slices.length - 1;
    const contentStart = hasPrev ? startSeconds + dummyHold : startSeconds;
    const contentEnd = hasNext ? endSeconds - dummyHold : endSeconds;
    // Skip dummy if content segment would be non-positive (e.g. short normalized slice)
    if (contentEnd <= contentStart) {
      parts.push(
        `[0:v]trim=start=${startSeconds}:end=${endSeconds},setpts=PTS-STARTPTS[v${i}]`
      );
      if (hasAudio) {
        parts.push(
          `[0:a]atrim=start=${startSeconds}:end=${endSeconds},asetpts=PTS-STARTPTS[a${i}]`
        );
      }
      continue;
    }

    if (!hasPrev && !hasNext) {
      parts.push(
        `[0:v]trim=start=${startSeconds}:end=${endSeconds},setpts=PTS-STARTPTS[v${i}]`
      );
      if (hasAudio) {
        parts.push(
          `[0:a]atrim=start=${startSeconds}:end=${endSeconds},asetpts=PTS-STARTPTS[a${i}]`
        );
      }
      continue;
    }

    if (!hasPrev) {
      // First slice, has next: content + freeze tail
      parts.push(
        `[0:v]trim=start=${startSeconds}:end=${contentEnd},setpts=PTS-STARTPTS[v${i}a]`
      );
      parts.push(
        `[0:v]trim=start=${endSeconds - eps}:end=${endSeconds},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${dummyHold},trim=start=${eps}:duration=${dummyHold}[v${i}b]`
      );
      parts.push(`[v${i}a][v${i}b]concat=n=2:v=1:a=0[v${i}]`);
    } else if (!hasNext) {
      // Last slice, has prev: freeze head + content
      parts.push(
        `[0:v]trim=start=${startSeconds}:end=${startSeconds + eps},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${dummyHold},trim=start=${eps}:duration=${dummyHold}[v${i}a]`
      );
      parts.push(
        `[0:v]trim=start=${contentStart}:end=${endSeconds},setpts=PTS-STARTPTS[v${i}b]`
      );
      parts.push(`[v${i}a][v${i}b]concat=n=2:v=1:a=0[v${i}]`);
    } else {
      // Middle: freeze head + content + freeze tail
      parts.push(
        `[0:v]trim=start=${startSeconds}:end=${startSeconds + eps},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${dummyHold},trim=start=${eps}:duration=${dummyHold}[v${i}a]`
      );
      parts.push(
        `[0:v]trim=start=${contentStart}:end=${contentEnd},setpts=PTS-STARTPTS[v${i}b]`
      );
      parts.push(
        `[0:v]trim=start=${endSeconds - eps}:end=${endSeconds},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${dummyHold},trim=start=${eps}:duration=${dummyHold}[v${i}c]`
      );
      parts.push(`[v${i}a][v${i}b][v${i}c]concat=n=3:v=1:a=0[v${i}]`);
    }

    if (hasAudio) {
      parts.push(
        `[0:a]atrim=start=${startSeconds}:end=${endSeconds},asetpts=PTS-STARTPTS[a${i}]`
      );
    }
  }

  if (slices.length === 1) {
    const filterComplex = parts.join(';');
    return {
      filterComplex,
      mapVideo: '[v0]',
      mapAudio: hasAudio ? '[a0]' : null,
    };
  }

  let prevV = 'v0';
  let prevA = 'a0';
  let cumulativeOutDuration = durations[0];

  for (let i = 1; i < slices.length; i++) {
    const nextV = `v${i}`;
    const nextA = `a${i}`;
    const outV = i === slices.length - 1 ? 'vout' : `v${i - 1}${i}`;
    const outA = i === slices.length - 1 ? 'aout' : `a${i - 1}${i}`;

    const sliceTransition = slices[i].transition;
    if (!sliceTransition) {
      throw new Error(
        `Missing transition for boundary before slice index ${i}; engine should provide default/common transition.`
      );
    }

    const maxT = Math.min(durations[i - 1], durations[i]) - 0.01;
    let t = Math.min(sliceTransition.duration, Math.max(0.01, maxT));
    if (dummyHold > 0) t = Math.min(t, dummyHold - 0.01);
    const type = sliceTransition.type;
    const offset = cumulativeOutDuration - t;

    parts.push(
      `[${prevV}][${nextV}]xfade=transition=${type}:duration=${t}:offset=${offset}[${outV}]`
    );
    if (hasAudio) {
      parts.push(
        `[${prevA}][${nextA}]acrossfade=d=${t}:c1=qsin:c2=qsin[${outA}]`
      );
    }

    cumulativeOutDuration = cumulativeOutDuration + durations[i] - t;
    prevV = outV;
    prevA = outA;
  }

  parts.push('[vout]format=yuv420p[v420]');
  const filterComplex = parts.join(';');
  return {
    filterComplex,
    mapVideo: '[v420]',
    mapAudio: hasAudio ? '[aout]' : null,
  };
}

module.exports = {
  cropTo916Filter,
  cropTo916DynamicFilter,
  subtitleFilter,
  amixFilter,
  buildSlicesWithTransitionsFilter,
  SHORTS_WIDTH,
  SHORTS_HEIGHT,
  getVerticalSize,
  VERTICAL_RESOLUTIONS,
};
