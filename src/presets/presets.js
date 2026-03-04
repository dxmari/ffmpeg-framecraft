const { MEDIA_PRESETS } = require('./media');

/**
 * Platform and workflow presets for video processing.
 * Use these with FramecraftEngine for consistent output across YouTube Shorts, TikTok, etc.
 *
 * @example
 * const { youtubeShortPreset } = require('./presets/presets');
 * engine.slicesWithTransitions(input, output, {
 *   slices: [...],
 *   transition: youtubeShortPreset.transition
 * });
 */

/** @constant {object} YouTube Shorts preset */
const youtubeShortPreset = {
  aspectRatio: '9:16',
  resolution: '1080x1920',
  width: 1080,
  height: 1920,
  subtitles: true,
  watermark: true,
  transition: 'fadeblack',
  transitionDuration: 1,
  videoCodec: 'libx264',
  audioCodec: 'aac',
  crf: 23,
  audioBitrate: '128k',
};

/** @constant {object} TikTok preset */
const tiktokPreset = {
  aspectRatio: '9:16',
  resolution: '1080x1920',
  width: 1080,
  height: 1920,
  subtitles: true,
  watermark: false,
  transition: 'fade',
  transitionDuration: 0.5,
  videoCodec: 'libx264',
  audioCodec: 'aac',
  crf: 23,
  audioBitrate: '128k',
};

/** @constant {object} Instagram Reels preset */
const instagramReelsPreset = {
  aspectRatio: '9:16',
  resolution: '1080x1920',
  width: 1080,
  height: 1920,
  subtitles: true,
  watermark: false,
  transition: 'dissolve',
  transitionDuration: 0.5,
  videoCodec: 'libx264',
  audioCodec: 'aac',
  crf: 23,
  audioBitrate: '128k',
};

/** @constant {object} Generic vertical/shorts preset (1080p default; use resolution '720' for lighter) */
const shortsPresetConfig = {
  aspectRatio: '9:16',
  resolution: '1080x1920',
  width: 1080,
  height: 1920,
  subtitles: true,
  watermark: false,
  transition: 'fade',
  transitionDuration: 0.5,
  videoCodec: 'libx264',
  profile: 'baseline',
  level: '3.0',
  audioCodec: 'aac',
  crf: 23,
  audioBitrate: '128k',
};

/** All platform presets keyed by name */
const PLATFORM_PRESETS = {
  youtubeShort: youtubeShortPreset,
  tiktok: tiktokPreset,
  instagramReels: instagramReelsPreset,
  shorts: shortsPresetConfig,
};

/**
 * Get a platform preset by name.
 * @param {string} name - Preset name (youtubeShort, tiktok, instagramReels, shorts)
 * @returns {object}
 */
function getPreset(name) {
  const p = PLATFORM_PRESETS[name];
  if (!p) throw new Error(`Unknown preset: ${name}. Use: ${Object.keys(PLATFORM_PRESETS).join(', ')}`);
  return { ...p };
}

module.exports = {
  youtubeShortPreset,
  tiktokPreset,
  instagramReelsPreset,
  shortsPresetConfig,
  PLATFORM_PRESETS,
  getPreset,
  MEDIA_PRESETS,
};
