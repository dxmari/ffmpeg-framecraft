/**
 * Shorts preset: 720x1280, H.264 baseline, AAC.
 * Optimized for YouTube Shorts / TikTok / vertical video platforms.
 *
 * Quality levels:
 * - fast:     smaller, faster encode
 * - balanced: good default
 * - high:     higher quality, slower encode
 *
 * @param {'fast'|'balanced'|'high'} [quality='balanced']
 * @returns {string[]} ffmpeg output options
 */
function outputOptions(quality = 'balanced') {
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
  };

  const q = table[quality] || table.balanced;

  return [
    '-c:v',
    'libx264',
    '-preset',
    q.preset,
    '-crf',
    q.crf,
    '-profile:v',
    'baseline',
    '-level',
    '3.0',
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
