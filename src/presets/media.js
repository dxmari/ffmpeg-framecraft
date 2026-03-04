const fs = require('fs');

/**
 * High-level media presets built on top of FramecraftEngine.compose.
 *
 * These are convenience “recipes” for common workflows like shorts/reels.
 * They stay fully customizable via the options object.
 */

/**
 * Compose a shorts-style vertical highlight:
 * - Optional crop (static / smart / AutoCrop-vertical)
 * - slicesWithTransitions
 * - optional subtitles
 * - optional background music
 *
 * @param {import('../engine')} engineInstance - FramecraftEngine instance
 * @param {string} inputPath
 * @param {string} outputPath
 * @param {object} options
 * @param {'static'|'smart'|'autocrop'} [options.cropMode='smart']
 * @param {Array<{ start: number|string, end: number|string, transition?: any }>} [options.slices]
 * @param {string} [options.preset='youtubeShort']
 * @param {string|{ type: string, duration: number }} [options.transition]
 * @param {number} [options.transitionDummyHold=0] - Seconds of frozen frame at each cut for smoother transitions (e.g. 1)
 * @param {{ srtPath: string }|undefined} [options.subtitles]
 * @param {{ musicPath: string }|undefined} [options.music]
 * @param {object} [options.autocrop] - Extra options passed to cropTo916AutoCropVertical
 * @param {(p: object) => void} [options.onProgress]
 */
async function composeShorts(engineInstance, inputPath, outputPath, options = {}) {
  const {
    cropMode = 'smart',
    slices = [],
    preset = 'youtubeShort',
    transition,
    transitionDummyHold,
    subtitles,
    music,
    autocrop = {},
    onProgress,
    quality = 'high',
  } = options;

  // 1) Build the highlight first on the original input
  const tempHighlight = outputPath.replace(/(\.\w+)?$/, '_highlight$1');
  let current = inputPath;

  // Build compose pipeline to produce the highlight
  const pipeline = [];

  if (slices.length) {
    pipeline.push({
      op: 'slicesWithTransitions',
      slices,
      preset,
      transition,
      transitionDummyHold,
    });
  }

  if (subtitles?.srtPath) {
    pipeline.push({
      op: 'subtitles',
      srtPath: subtitles.srtPath,
    });
  }

  if (music?.musicPath) {
    pipeline.push({
      op: 'music',
      musicPath: music.musicPath,
    });
  }

  if (pipeline.length === 0) {
    // No slices / subtitles / music requested: just crop the original.
    current = inputPath;
  } else {
    await engineInstance.compose(current, tempHighlight, pipeline, { onProgress, quality });
    current = tempHighlight;
  }

  // 2) Crop stage on the final highlight
  if (cropMode === 'autocrop') {
    await engineInstance.cropTo916AutoCropVertical(current, outputPath, autocrop);
  } else if (cropMode === 'smart' || cropMode === 'static') {
    await engineInstance.cropTo916(current, outputPath, {
      smart: cropMode === 'smart',
      smartTwoShot: true,
      smartSpeakerBias: true,
      smartSampleEvery: 0.15,
      onProgress,
    });
  } else if (current !== outputPath) {
    // No crop requested: just ensure the highlight ends up at outputPath.
    await engineInstance.compose(current, outputPath, [], { onProgress, quality });
  }

  // 3) Cleanup temp highlight if it was created
  if (tempHighlight !== outputPath) {
    try {
      fs.unlinkSync(tempHighlight);
    } catch {
      // ignore cleanup errors
    }
  }
}

/**
 * Compose a YouTube Shorts-style highlight.
 * Thin wrapper around composeShorts with preset defaulted to 'youtubeShort'.
 */
async function composeYoutubeShort(engineInstance, inputPath, outputPath, options = {}) {
  await composeShorts(engineInstance, inputPath, outputPath, {
    preset: 'youtubeShort',
    ...options,
  });
}

/**
 * Compose an Instagram Reels-style highlight.
 * Uses the 'instagramReels' platform preset by default.
 */
async function composeReels(engineInstance, inputPath, outputPath, options = {}) {
  await composeShorts(engineInstance, inputPath, outputPath, {
    preset: 'instagramReels',
    ...options,
  });
}

/**
 * Compose a TikTok-style highlight.
 * Uses the 'tiktok' platform preset by default.
 */
async function composeTiktok(engineInstance, inputPath, outputPath, options = {}) {
  await composeShorts(engineInstance, inputPath, outputPath, {
    preset: 'tiktok',
    ...options,
  });
}

const MEDIA_PRESETS = {
  composeShorts,
  composeYoutubeShort,
  composeReels,
  composeTiktok,
};

module.exports = {
  MEDIA_PRESETS,
  composeShorts,
  composeYoutubeShort,
  composeReels,
  composeTiktok,
};

