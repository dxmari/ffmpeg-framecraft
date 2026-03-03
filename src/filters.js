const path = require('path');

/** @constant {string} Shorts target width */
const SHORTS_WIDTH = 720;
/** @constant {string} Shorts target height */
const SHORTS_HEIGHT = 1280;

/**
 * Build FFmpeg -vf filter string for 9:16 vertical crop (Shorts/TikTok format).
 * Crops centered 9:16 region from source, then scales to 720x1280.
 *
 * @param {number} width - Source video width
 * @param {number} height - Source video height
 * @returns {string} FFmpeg video filter string (crop,scale)
 */
function cropTo916Filter(width, height) {
  const cropWidth = Math.floor((height * 9) / 16);
  const cropHeight = height;
  const x = Math.floor((width - cropWidth) / 2);
  const y = 0;

  const crop = `crop=${cropWidth}:${cropHeight}:${x}:${y}`;
  const scale = `scale=${SHORTS_WIDTH}:${SHORTS_HEIGHT}`;

  return `${crop},${scale}`;
}

/**
 * Build FFmpeg -vf filter string for content-aware crop using time-based keyframes.
 *
 * This supports both:
 * - TRACK mode: crop to 9:16 window (w=cropWidth) with dynamic x
 * - LETTERBOX mode: use full width (w=srcWidth, x=0) then scale+pad to 720x1280
 *
 * The output chain always ends with scale-to-width + pad so that both track and
 * letterbox produce a consistent 720x1280 output without stretching.
 *
 * @param {number} width - Source video width
 * @param {number} height - Source video height
 * @param {Array<{ t: number, x: number, w?: number }>} keyframes - Sorted keyframes in seconds; w is crop width in pixels
 * @returns {string} FFmpeg video filter string
 */
function cropTo916DynamicFilter(width, height, keyframes) {
  if (!Array.isArray(keyframes) || keyframes.length === 0) {
    return cropTo916Filter(width, height);
  }

  const cropWidthRaw = Math.floor((height * 9) / 16);
  const cropWidth = cropWidthRaw - (cropWidthRaw % 2);
  const maxX = Math.max(0, width - cropWidth);

  const frames = [...keyframes]
    .filter((k) => k && Number.isFinite(k.t) && Number.isFinite(k.x))
    .sort((a, b) => a.t - b.t)
    .map((k) => ({
      t: Math.max(0, k.t),
      x: Math.max(0, Math.min(maxX, k.x)),
      w: Number.isFinite(k.w) ? k.w : cropWidth,
    }));

  if (frames.length === 0) {
    return cropTo916Filter(width, height);
  }

  // Build a piecewise-linear x(t) with nested if(between(t,...), ..., next).
  // Keep x even for encoder friendliness: 2*trunc(x/2)
  let expr = `${frames[frames.length - 1].x}`;
  for (let i = frames.length - 2; i >= 0; i--) {
    const t0 = frames[i].t;
    const t1 = frames[i + 1].t;
    const x0 = frames[i].x;
    const x1 = frames[i + 1].x;

    if (t1 <= t0 + 1e-6) {
      expr = `${x0}`;
      continue;
    }

    const seg = `(${x0}+(${x1}-${x0})*(t-${t0})/(${t1}-${t0}))`;
    expr = `if(between(t\\,${t0}\\,${t1})\\,${seg}\\,${expr})`;
  }

  const xExpr = `2*trunc((${expr})/2)`;

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
  const scale = `scale=${SHORTS_WIDTH}:-2`;
  const pad = `pad=${SHORTS_WIDTH}:${SHORTS_HEIGHT}:(ow-iw)/2:(oh-ih)/2`;
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
 * Each slice may optionally carry its own transition ({ type, duration }) which
 * controls how the previous slice transitions into this one. If not present,
 * the caller should already have applied the default/common transition.
 *
 * @param {Array<{ startSeconds: number, endSeconds: number, transition?: { type: string, duration: number } }>} slices
 *        Normalized slice ranges in seconds, with optional per-slice transition (for slice i > 0).
 * @param {boolean} hasAudio - Whether input has audio (to include acrossfade)
 * @returns {{ filterComplex: string, mapVideo: string, mapAudio: string | null }}
 */
function buildSlicesWithTransitionsFilter(slices, hasAudio = true) {
  if (!slices.length) throw new Error('slices must have at least one range');

  const parts = [];
  const durations = [];

  for (let i = 0; i < slices.length; i++) {
    const { startSeconds, endSeconds } = slices[i];
    const d = endSeconds - startSeconds;
    durations.push(d);
    parts.push(
      `[0:v]trim=start=${startSeconds}:end=${endSeconds},setpts=PTS-STARTPTS[v${i}]`
    );
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
    const t = Math.min(sliceTransition.duration, Math.max(0.01, maxT));
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
};
