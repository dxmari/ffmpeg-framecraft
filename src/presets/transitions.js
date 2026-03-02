/**
 * Transition presets for use with slicesWithTransitions.
 * Maps preset names to FFmpeg xfade transition types and default duration.
 *
 * @see https://ffmpeg.org/ffmpeg-filters.html#xfade
 */
const PRESETS = {
  fade: { type: 'fade', duration: 0.5 },
  fadeLong: { type: 'fade', duration: 1 },
  wipeleft: { type: 'wipeleft', duration: 0.5 },
  wiperight: { type: 'wiperight', duration: 0.5 },
  wipeup: { type: 'wipeup', duration: 0.5 },
  wipedown: { type: 'wipedown', duration: 0.5 },
  slideleft: { type: 'slideleft', duration: 0.5 },
  slideright: { type: 'slideright', duration: 0.5 },
  slideup: { type: 'slideup', duration: 0.5 },
  slidedown: { type: 'slidedown', duration: 0.5 },
  circleopen: { type: 'circleopen', duration: 0.5 },
  circleclose: { type: 'circleclose', duration: 0.5 },
  rectcrop: { type: 'rectcrop', duration: 0.5 },
  distance: { type: 'distance', duration: 0.5 },
  fadeblack: { type: 'fadeblack', duration: 0.5 },
  fadewhite: { type: 'fadewhite', duration: 0.5 },
  radial: { type: 'radial', duration: 0.5 },
  dissolve: { type: 'dissolve', duration: 0.5 },
  pixelize: { type: 'pixelize', duration: 0.5 },
  zoomin: { type: 'zoomin', duration: 0.5 },
  zoomout: { type: 'zoomout', duration: 0.5 },
};

function getTransition(presetOrObject) {
  if (typeof presetOrObject === 'string') {
    const p = PRESETS[presetOrObject];
    if (!p) throw new Error(`Unknown transition preset: ${presetOrObject}`);
    return { ...p };
  }
  if (presetOrObject && typeof presetOrObject.type === 'string') {
    return {
      type: presetOrObject.type,
      duration: presetOrObject.duration ?? 0.5,
    };
  }
  return { type: 'fade', duration: 0.5 };
}

module.exports = {
  PRESETS,
  getTransition,
};
