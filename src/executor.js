const ffmpeg = require('fluent-ffmpeg');

/**
 * FFmpegExecutor - Single point of FFmpeg invocation.
 * Wraps fluent-ffmpeg; can be swapped for raw spawn in Phase 2.
 *
 * Use complexFilter + complexFilterMap for -filter_complex (recommended) — uses
 * fluent-ffmpeg's native API. Pass outputOptions only for encoding options.
 *
 * @typedef {object} ExecutorConfig
 * @property {string} input - Input file path
 * @property {string|string[]} [inputs] - Additional inputs (for multi-input commands)
 * @property {string} output - Output file path
 * @property {string|string[]} [videoFilters] - Video filter chain (-vf)
 * @property {string|string[]} [audioFilters] - Audio filter chain (-af)
 * @property {string} [complexFilter] - Full -filter_complex string (use fluent API; do not put in outputOptions)
 * @property {string|string[]} [complexFilterMap] - Streams to map from filter (e.g. '[vout]' or ['[vout]','[aout]'])
 * @property {string|string[]} [inputOptions] - Input options
 * @property {string|string[]} [outputOptions] - Output options (encoding only; no -filter_complex/-map when using complexFilter)
 * @property {number|string} [seek] - Input start time (seconds or timestamp)
 * @property {number|string} [duration] - Output duration (seconds or timestamp)
 * @property {number} [frames] - Number of frames to encode
 * @property {string} [format] - Output format (e.g. 'mp4', 'image2')
 * @property {number} [expectedDuration] - Expected output duration in seconds (for percent calculation)
 * @property {function(object): void} [onProgress] - Progress callback
 */

function timemarkToSeconds(timemark) {
  if (!timemark) return 0;
  const parts = String(timemark).split(':');
  if (parts.length !== 3) return 0;
  const [h, m, s] = parts;
  const seconds = parseFloat(s);
  if (Number.isNaN(seconds)) return 0;
  return Number(h) * 3600 + Number(m) * 60 + seconds;
}

/**
 * Run FFmpeg with the given configuration.
 *
 * @param {ExecutorConfig} config
 * @returns {Promise<void>}
 */
function run(config) {
  return new Promise((resolve, reject) => {
    const {
      input,
      inputs = [],
      output,
      videoFilters,
      audioFilters,
      complexFilter,
      complexFilterMap,
      inputOptions,
      outputOptions,
      seek,
      duration,
      frames,
      format,
      expectedDuration,
      onProgress,
    } = config;

    let command = ffmpeg(input);

    const extraInputs = Array.isArray(inputs) ? inputs : [inputs].filter(Boolean);
    for (const inp of extraInputs) {
      command = command.input(inp);
    }

    if (seek != null) {
      command = command.seekInput(seek);
    }
    if (inputOptions && inputOptions.length > 0) {
      command = command.inputOptions(inputOptions);
    }

    if (duration != null) {
      command = command.duration(duration);
    }
    if (frames != null) {
      command = command.frames(frames);
    }
    if (videoFilters) {
      const vf = Array.isArray(videoFilters) ? videoFilters : [videoFilters];
      command = command.videoFilters(vf);
    }
    if (audioFilters) {
      const af = Array.isArray(audioFilters) ? audioFilters : [audioFilters];
      command = command.audioFilters(af);
    }
    if (format) {
      command = command.format(format);
    }

    if (complexFilter) {
      const mapArr = complexFilterMap != null
        ? (Array.isArray(complexFilterMap) ? complexFilterMap : [complexFilterMap])
        : [];
      command = command.complexFilter(complexFilter, mapArr.length ? mapArr : undefined);
    }
    if (outputOptions && outputOptions.length > 0) {
      command = command.outputOptions(...outputOptions);
    }

    command = command.output(output);

    if (typeof onProgress === 'function') {
      command.on('progress', (progress) => {
        const next = { ...progress };
        if (expectedDuration && expectedDuration > 0 && next.timemark) {
          const currentSeconds = timemarkToSeconds(next.timemark);
          const rawPercent = (currentSeconds / expectedDuration) * 100;
          if (Number.isFinite(rawPercent)) {
            next.percent = Math.max(0, Math.min(100, rawPercent));
          }
        }
        onProgress(next);
      });
    }
    command.on('error', (err, stdout, stderr) => {
      if (stderr && err.message && !err.message.includes('FFmpeg stderr:')) {
        const tail = stderr.trim().split('\n').slice(-30).join('\n');
        if (tail) err.message += '\n\nFFmpeg stderr:\n' + tail;
      }
      reject(err);
    });
    command.on('end', () => {
      // if (typeof onProgress === 'function') onProgress({ percent: 100 });
      resolve();
    });

    command.run();
  });
}

/**
 * Get video metadata (width, height, duration, etc.) via ffprobe.
 *
 * @param {string} inputPath
 * @returns {Promise<{ width: number, height: number, duration: number, hasAudio: boolean }>}
 */
function probe(inputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err, metadata) => {
      if (err) return reject(err);

      const videoStream = metadata.streams?.find((s) => s.codec_type === 'video');
      const audioStream = metadata.streams?.find((s) => s.codec_type === 'audio');

      const width = videoStream?.width ?? 0;
      const height = videoStream?.height ?? 0;
      const duration = metadata.format?.duration ?? 0;
      const hasAudio = !!audioStream;

      resolve({ width, height, duration, hasAudio });
    });
  });
}

module.exports = {
  run,
  probe,
};
