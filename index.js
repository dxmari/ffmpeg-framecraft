const { FramecraftEngine } = require('./src/engine');
const { cropTo916Filter, cropTo916DynamicFilter, subtitleFilter, amixFilter, buildSlicesWithTransitionsFilter, SHORTS_WIDTH, SHORTS_HEIGHT } = require('./src/filters');
const { PRESETS: TRANSITION_PRESETS, getTransition } = require('./src/presets/transitions');
const { MEDIA_PRESETS, composeShorts } = require('./src/presets/media');
const {
  youtubeShortPreset,
  tiktokPreset,
  instagramReelsPreset,
  shortsPresetConfig,
  PLATFORM_PRESETS,
  getPreset,
} = require('./src/presets/presets');

module.exports = {
  FramecraftEngine,
  cropTo916Filter,
  cropTo916DynamicFilter,
  subtitleFilter,
  amixFilter,
  buildSlicesWithTransitionsFilter,
  SHORTS_WIDTH,
  SHORTS_HEIGHT,
  TRANSITION_PRESETS,
  getTransition,
  youtubeShortPreset,
  tiktokPreset,
  instagramReelsPreset,
  shortsPresetConfig,
  PLATFORM_PRESETS,
  getPreset,
  MEDIA_PRESETS,
  composeShorts,
};
