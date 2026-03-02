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
  subtitleFilter,
  amixFilter,
  buildSlicesWithTransitionsFilter,
  SHORTS_WIDTH,
  SHORTS_HEIGHT,
};
