/**
 * Shorts preset: default 1080×1920 (9:16), H.264 baseline, AAC.
 * Use resolution '720' in crop opts for 720×1280 (lighter files).
 * Optimized for YouTube Shorts / TikTok / vertical video platforms.
 *
 * Quality levels:
 * - fast:     smaller, faster encode
 * - balanced: good default
 * - high:     higher quality, slower encode
 * - max:      maximum quality (lowest CRF, slowest preset), largest files
 *
 * @param {'fast'|'balanced'|'high'|'max'} [quality='balanced']
 * @param {{ crf?: number, preset?: string }} [overrides] - Optional CRF/preset overrides (e.g. crf: 14, preset: 'veryslow')
 * @returns {string[]} ffmpeg output options
 */
function outputOptions(quality = 'balanced', overrides = {}) {
  const table = {
    fast: {
      crf: '28',
      preset: 'veryfast',
    },
    balanced: {
      crf: '23',
      preset: 'fast',
    },
    high: {
      crf: '18',
      preset: 'slow',
    },
    max: {
      crf: '15',
      preset: 'veryslow',
    },
  };

  const q = table[quality] || table.balanced;
  const crf = overrides.crf != null ? String(overrides.crf) : q.crf;
  const preset = overrides.preset != null ? overrides.preset : q.preset;

  return [
    '-c:v',
    'libx264',
    '-preset',
    preset,
    '-crf',
    crf,
    '-profile:v',
    'baseline',
    '-level',
    '4.0',  // 720×1280 and 1080×1920 both need level 4.0+
    '-movflags',
    '+faststart',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
  ];
}

module.exports = {
  outputOptions,
};
