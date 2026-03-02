const path = require('path');
const fs = require('fs');
const { run, probe } = require('./executor');
const { cropTo916Filter, subtitleFilter, amixFilter, buildSlicesWithTransitionsFilter } = require('./filters');
const shortsPreset = require('./presets/shorts');
const { getTransition } = require('./presets/transitions');
const { getPreset } = require('./presets/presets');
const { timeStringToSeconds } = require('./utils');

function sliceTimeToSeconds(value) {
  if (typeof value === 'number' && !Number.isNaN(value)) return value;
  if (typeof value === 'string') return timeStringToSeconds(value);
  throw new Error(`Invalid slice time: ${value}`);
}

/**
 * FramecraftEngine - FFmpeg-based video processing (crop, slice, transitions, subtitles, audio).
 */
class FramecraftEngine {
  /**
   * Crop video to 9:16 vertical format (720x1280).
   * Uses ffprobe to get dimensions, then applies centered crop + scale.
   *
   * @param {string} inputPath - Input video path
   * @param {string} outputPath - Output video path
   * @param {object} [opts] - Options (future: quality presets, etc.)
   * @param {function(object): void} [opts.onProgress] - Progress callback
   * @returns {Promise<void>}
   */
  async cropTo916(inputPath, outputPath, opts = {}) {
    const meta = await probe(inputPath);
    const filter = cropTo916Filter(meta.width, meta.height);

    await run({
      input: inputPath,
      output: outputPath,
      videoFilters: filter,
      outputOptions: shortsPreset.outputOptions(),
      expectedDuration: meta.duration || undefined,
      onProgress: opts.onProgress,
    });
  }

  /**
   * Slice video by timestamp range.
   *
   * @param {string} inputPath - Input video path
   * @param {string} outputPath - Output video path
   * @param {{ start: number|string, end: number|string }} range - Start and end time (seconds or "mm:ss.ms")
   * @param {object} [opts] - Options
   * @param {function(object): void} [opts.onProgress] - Progress callback
   * @returns {Promise<void>}
   */
  async slice(inputPath, outputPath, range, opts = {}) {
    let { start, end } = range;
    start = typeof start === 'string' ? timeStringToSeconds(start) : start;
    end = typeof end === 'string' ? timeStringToSeconds(end) : end;
    const duration =
      typeof start === 'number' && typeof end === 'number'
        ? end - start
        : undefined;

    await run({
      input: inputPath,
      output: outputPath,
      seek: start,
      duration,
      outputOptions: shortsPreset.outputOptions(),
      expectedDuration: typeof duration === 'number' ? duration : undefined,
      onProgress: opts.onProgress,
    });
  }

  /**
   * Add SRT subtitle overlay to video.
   *
   * @param {string} inputPath - Input video path
   * @param {string} outputPath - Output video path
   * @param {string} srtPath - Path to SRT file
   * @param {object} [opts] - Style options for future AI caption styling
   * @param {function(object): void} [opts.onProgress] - Progress callback
   * @returns {Promise<void>}
   */
  async addSubtitles(inputPath, outputPath, srtPath, opts = {}) {
    const { onProgress, ...style } = opts;
    const filter = subtitleFilter(srtPath, style);

    await run({
      input: inputPath,
      output: outputPath,
      videoFilters: filter,
      outputOptions: shortsPreset.outputOptions(),
      onProgress,
    });
  }

  /**
   * Extract a single frame as thumbnail image.
   *
   * @param {string} inputPath - Input video path
   * @param {string} outputPath - Output path (e.g. frame.jpg)
   * @param {number|string} [time=0] - Timestamp in seconds or "mm:ss.ms"
   * @returns {Promise<void>}
   */
  async extractThumbnail(inputPath, outputPath, time = 0) {
    const ext = path.extname(outputPath).toLowerCase();
    const format = ext === '.png' ? 'png' : 'image2';

    await run({
      input: inputPath,
      output: outputPath,
      seek: time,
      frames: 1,
      format,
    });
  }

  /**
   * Mix background music with video.
   * Video keeps original stream; audio is mix of video audio + music (or music only if no video audio).
   *
   * @param {string} inputPath - Input video path
   * @param {string} outputPath - Output video path
   * @param {string} musicPath - Path to music/audio file
   * @param {object} [opts] - Options
   * @param {number} [opts.musicVolume=1] - Music volume 0-1 (future)
   * @param {function(object): void} [opts.onProgress] - Progress callback
   * @returns {Promise<void>}
   */
  async addBackgroundMusic(inputPath, outputPath, musicPath, opts = {}) {
    const { onProgress } = opts;
    const meta = await probe(inputPath);
    const filterComplex = amixFilter(meta.hasAudio);

    await run({
      input: inputPath,
      inputs: [musicPath],
      output: outputPath,
      complexFilter: filterComplex,
      complexFilterMap: ['0:v', '[aout]'],
      outputOptions: [
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '23',
        '-c:a', 'aac', '-b:a', '128k',
      ],
      expectedDuration: meta.duration || undefined,
      onProgress,
    });
  }

  /**
   * Extract multiple slices from one video and join them with transitions.
   * Use this to build a single output from several time ranges (e.g. 0–10s, 20–30s, 40–50s) with fade/wipe/slide between clips.
   *
   * @param {string} inputPath - Input video path
   * @param {string} outputPath - Output video path
   * @param {object} options - Options
   * @param {Array<{ start: number|string, end: number|string }>} options.slices - Time ranges (seconds or "H:MM:SS" / "MM:SS")
   * @param {string|{ type: string, duration: number }} [options.transition='fade'] - Preset name (e.g. 'fade', 'wipeleft', 'dissolve') or { type, duration } in seconds
   * @param {object} [opts] - Additional options
   * @param {function(object): void} [opts.onProgress] - Progress callback
   * @returns {Promise<void>}
   */
  async slicesWithTransitions(inputPath, outputPath, options, opts = {}) {
    const { slices, preset } = options;
    let transitionOption = options.transition;
    if (transitionOption === undefined && preset) {
      const p = typeof preset === 'string' ? getPreset(preset) : preset;
      transitionOption = p.transition != null
        ? { type: p.transition, duration: p.transitionDuration ?? 0.5 }
        : 'fade';
    }
    transitionOption = transitionOption ?? 'fade';
    if (!Array.isArray(slices) || slices.length === 0) {
      throw new Error('slicesWithTransitions requires a non-empty slices array');
    }

    const meta = await probe(inputPath);
    const fileDuration = meta.duration || 0;

    const defaultTransition = getTransition(transitionOption);
    const slicesNormalized = slices.map((slice, index) => {
      let startSeconds = sliceTimeToSeconds(slice.start);
      let endSeconds = sliceTimeToSeconds(slice.end);

      if (fileDuration > 0) {
        endSeconds = Math.min(endSeconds, fileDuration);
        startSeconds = Math.min(startSeconds, endSeconds - 0.01);
      }
      const duration = endSeconds - startSeconds;
      if (duration <= 0) {
        throw new Error(
          `slicesWithTransitions: slice ${index} has invalid or zero duration (start=${slice.start}, end=${slice.end}); file duration is ${fileDuration}s`
        );
      }

      // For boundary between slice[i-1] -> slice[i], use slice.transition if provided,
      // otherwise fall back to the common/default transition.
      let transition = null;
      if (index > 0) {
        const transitionConfig = {
          type: slice.transition?.type ? slice.transition.type : defaultTransition.type,
          duration: slice.transition?.duration ? slice.transition.duration : defaultTransition.duration,
        }
        transition = getTransition(transitionConfig);
        console.log('transition', transition);
      }

      return { startSeconds, endSeconds, transition };
    });

    const durations = slicesNormalized.map(
      ({ startSeconds, endSeconds }) => endSeconds - startSeconds
    );

    let outputDuration = durations[0];
    for (let i = 1; i < durations.length; i++) {
      const prevDuration = durations[i - 1];
      const currentDuration = durations[i];
      const sliceTransition = slicesNormalized[i].transition;
      const maxT = Math.min(prevDuration, currentDuration) - 0.01;
      const t = Math.min(sliceTransition.duration, Math.max(0.01, maxT));
      outputDuration = outputDuration + currentDuration - t;
    }

    const { filterComplex, mapVideo, mapAudio } = buildSlicesWithTransitionsFilter(
      slicesNormalized,
      meta.hasAudio
    );

    const complexFilterMap = [mapVideo];
    if (mapAudio) complexFilterMap.push(mapAudio);

    await run({
      input: inputPath,
      output: outputPath,
      complexFilter: filterComplex,
      complexFilterMap,
      outputOptions: shortsPreset.outputOptions(),
      expectedDuration: outputDuration,
      onProgress: opts.onProgress,
    });
  }

  /**
   * Apply a named preset or run a pipeline of operations sequentially.
   *
   * @param {string} inputPath - Input video path
   * @param {string} outputPath - Output video path
   * @param {string|Array<{ op: string, [key: string]: any }>} [pipeline='shorts'] - Preset name or list of { op, ...args }
   * @param {object} [opts] - Options
   * @param {function(object): void} [opts.onProgress] - Progress callback
   * @returns {Promise<void>}
   */
  async compose(inputPath, outputPath, pipeline = 'shorts', opts = {}) {
    if (pipeline === 'shorts') {
      await this.cropTo916(inputPath, outputPath, opts);
      return;
    }

    if (!Array.isArray(pipeline) || pipeline.length === 0) {
      throw new Error(`Unknown preset or empty pipeline: ${pipeline}`);
    }

    let current = inputPath;
    const tempDir = path.dirname(outputPath);
    const intermediates = [];

    for (let i = 0; i < pipeline.length; i++) {
      const step = pipeline[i];
      const isLast = i === pipeline.length - 1;
      const stepOutputPath = typeof step === 'object' && step.outputPath != null
        ? step.outputPath
        : outputPath;
      const nextPath = isLast ? stepOutputPath : path.join(tempDir, `_compose_step_${i}.mp4`);

      if (!isLast) {
        intermediates.push(nextPath);
      }

      const op = typeof step === 'string' ? step : step.op;
      if (!op) throw new Error(`Pipeline step ${i} missing 'op'`);

      switch (op) {
        case 'crop916':
          await this.cropTo916(current, nextPath, opts);
          break;
        case 'slice':
          if (step.start == null || step.end == null) {
            throw new Error('slice step requires start and end');
          }
          await this.slice(current, nextPath, { start: step.start, end: step.end }, opts);
          break;
        case 'subtitles':
          if (!step.srtPath) throw new Error('subtitles step requires srtPath');
          await this.addSubtitles(current, nextPath, step.srtPath, opts);
          break;
        case 'music':
          if (!step.musicPath) throw new Error('music step requires musicPath');
          await this.addBackgroundMusic(current, nextPath, step.musicPath, opts);
          break;
        case 'slicesWithTransitions':
          if (!step.slices?.length) throw new Error('slicesWithTransitions step requires slices array');
          await this.slicesWithTransitions(current, nextPath, {
            slices: step.slices,
            transition: step.transition,
            preset: step.preset,
          }, opts);
          break;
        case 'audioOnly':
          if (!step.outputPath) throw new Error('extractAudioOnly step requires outputPath');
          await this.extractAudioOnly(current, step.outputPath, opts);
          break;
        default:
          throw new Error(`Unknown pipeline op: ${op}`);
      }

      current = nextPath;
    }

    for (const file of intermediates) {
      try {
        await fs.promises.unlink(file);
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
    }
  }

  /**
   * Extract audio only from video. Converts to MP3 or M4A based on output file extension.
   *
   * @param {string} inputPath - Input video path
   * @param {string} outputPath - Output audio path (.m4a = AAC, .mp3 = MP3)
   * @param {object} [opts] - Options
   * @param {number} [opts.bitrate] - Audio bitrate in kbps (default: 256 for AAC, 320 for MP3)
   * @param {number} [opts.sampleRate=48000] - Sample rate in Hz
   * @param {function(object): void} [opts.onProgress] - Progress callback
   * @returns {Promise<void>}
   */
  async extractAudioOnly(inputPath, outputPath, opts = {}) {
    const { onProgress, sampleRate = 48000 } = opts;
    const ext = path.extname(outputPath).toLowerCase();
    const isMp3 = ext === '.mp3';

    const bitrate = opts.bitrate ?? (isMp3 ? 320 : 256);
    const outputOptions = [
      '-vn',
      '-c:a',
      isMp3 ? 'libmp3lame' : 'aac',
      '-b:a',
      `${bitrate}k`,
      '-ar',
      String(sampleRate),
    ];

    await run({
      input: inputPath,
      output: outputPath,
      outputOptions,
      onProgress,
    });
  }
}

module.exports = { FramecraftEngine };
