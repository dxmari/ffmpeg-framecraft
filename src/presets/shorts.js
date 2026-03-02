/**
 * Shorts preset: 720x1280, H.264 baseline, AAC.
 * Optimized for YouTube Shorts / TikTok / vertical video platforms.
 */
function outputOptions() {
  return [
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '23',
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
