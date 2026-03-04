const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');
const { run, probe } = require('./executor');
const { cropTo916Filter, cropTo916DynamicFilter, subtitleFilter, amixFilter, buildSlicesWithTransitionsFilter, getVerticalSize } = require('./filters');
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
   * Crop video to 9:16 vertical format (default 1080×1920; use opts.resolution='720' for 720×1280).
   * Uses ffprobe to get dimensions, then applies centered crop + scale.
   *
   * @param {string} inputPath - Input video path
   * @param {string} outputPath - Output video path
   * @param {object} [opts] - Options
   * @param {function(object): void} [opts.onProgress] - Progress callback
   * @param {'fast'|'balanced'|'high'|'max'} [opts.quality='balanced'] - Encoding quality
   * @param {number} [opts.crf] - Override CRF (0-51). Overrides quality tier.
   * @param {string} [opts.preset] - Override x264 preset (e.g. 'veryslow'). Overrides quality tier.
   * @param {'720'|'1080'|'light'} [opts.resolution='1080'] - Output size: 720×1280, 1080×1920 (recommended), or light 406×720
   * @param {boolean} [opts.smart=false] - Enable content-aware (dynamic) crop
   * @param {number} [opts.smartSampleEvery=0.25] - Seconds between analysis samples (smart crop only)
   * @param {boolean} [opts.smartTwoShot=true] - When 2+ people are present, keep both in-frame if possible
   * @param {boolean} [opts.smartSpeakerBias=true] - Bias framing toward the speaking person (heuristic)
   * @returns {Promise<void>}
   */
  async cropTo916(inputPath, outputPath, opts = {}) {
    const meta = await probe(inputPath);
    if (opts.smart) {
      await this._cropTo916Smart(inputPath, outputPath, meta, opts);
      return;
    }

    const filter = cropTo916Filter(meta.width, meta.height, getVerticalSize(opts.resolution));

    await run({
      input: inputPath,
      output: outputPath,
      videoFilters: filter,
      outputOptions: shortsPreset.outputOptions(opts.quality, { crf: opts.crf, preset: opts.preset }),
      expectedDuration: meta.duration || undefined,
      onProgress: opts.onProgress,
    });
  }

  /**
   * Delegate 9:16 cropping to the Python AutoCrop-vertical tool for exact behavior.
   * This wraps https://github.com/kamilstanuch/Autocrop-vertical/main.py.
   *
   * Requirements:
   * - Clone the AutoCrop-vertical repo somewhere
   * - Either set AUTO_CROP_VERTICAL_DIR env var, or pass opts.pythonDir
   * - Have `python3` + its Python deps installed there
   *
   * @param {string} inputPath - Input video path
   * @param {string} outputPath - Output video path
   * @param {object} [opts]
   * @param {string} [opts.pythonDir] - Directory containing main.py (overrides AUTO_CROP_VERTICAL_DIR)
   * @param {string} [opts.pythonScript='main.py'] - Script filename inside pythonDir
   * @param {string} [opts.pythonCommand='python3'] - Python executable
   * @param {string} [opts.ratio] - Output aspect ratio, e.g. '9:16', '4:5', '1:1'
   * @param {string} [opts.quality] - 'fast' | 'balanced' | 'high'
   * @param {number} [opts.crf] - CRF override (libx264 only)
   * @param {string} [opts.preset] - x264 preset override, e.g. 'medium'
   * @param {boolean} [opts.planOnly] - Pass --plan-only (no encoding)
   * @param {boolean} [opts.encodeWithFramecraft=false] - If true, run AutoCrop with --plan-only, read plan JSON, then encode with Node (single pass, better quality). Requires setup-autocrop to have applied the plan-output patch.
   * @param {'720'|'1080'|'light'} [opts.resolution='1080'] - Output size when using encodeWithFramecraft: 720×1280, 1080×1920, or light 406×720
   * @param {number} [opts.frameSkip] - Scene detection frame skip
   * @param {number} [opts.downscale] - Scene detection downscale
   * @param {string} [opts.encoder] - 'auto' | 'hw' | specific encoder name
   * @param {boolean} [opts.verbose=false] - If true, pipe Python stdout/stderr to this process
   * @returns {Promise<void>}
   */
  async cropTo916AutoCropVertical(inputPath, outputPath, opts = {}) {
    let pythonDir = opts.pythonDir || process.env.AUTO_CROP_VERTICAL_DIR;
    let pythonCommand = opts.pythonCommand || process.env.AUTO_CROP_VERTICAL_PY || 'python3';

    // If a config file from the setup script exists, let it provide defaults.
    const configPath = path.join(process.cwd(), '.autocrop-config.json');
    if (fs.existsSync(configPath)) {
      try {
        const raw = fs.readFileSync(configPath, 'utf8');
        const cfg = JSON.parse(raw);
        pythonDir = opts.pythonDir || pythonDir || cfg.pythonDir;
        pythonCommand = opts.pythonCommand || pythonCommand || cfg.pythonCommand;
      } catch {
        // ignore malformed config and fall back to env/opts
      }
    }

    if (!pythonDir) {
      throw new Error(
        'cropTo916AutoCropVertical requires the AutoCrop-vertical repo. ' +
        'Run `npx ffmpeg-framecraft-setup-autocrop` or set AUTO_CROP_VERTICAL_DIR / opts.pythonDir.'
      );
    }

    const pythonScript = opts.pythonScript || 'main.py';

    const args = [pythonScript, '-i', inputPath, '-o', outputPath];

    // Python only accepts 'fast'|'balanced'|'high'; map 'max' -> 'high' or omit
    const pyQuality = opts.quality === 'max' ? 'high' : opts.quality;
    if (pyQuality && ['fast', 'balanced', 'high'].includes(pyQuality)) {
      args.push('--quality', pyQuality);
    }
    if (opts.ratio) args.push('--ratio', String(opts.ratio));
    if (opts.crf != null) args.push('--crf', String(opts.crf));
    if (opts.preset) args.push('--preset', String(opts.preset));
    if (opts.frameSkip != null) args.push('--frame-skip', String(opts.frameSkip));
    if (opts.downscale != null) args.push('--downscale', String(opts.downscale));
    if (opts.encoder) args.push('--encoder', String(opts.encoder));
    if (opts.planOnly && !opts.encodeWithFramecraft) args.push('--plan-only');

    // Plan-only then encode in Node (single pass, better quality)
    if (opts.encodeWithFramecraft) {
      const planPath = path.join(os.tmpdir(), `framecraft-autocrop-plan-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
      args.push('--plan-only', '--plan-output', planPath);
      try {
        await new Promise((resolve, reject) => {
          const child = spawn(pythonCommand, args, {
            cwd: pythonDir,
            stdio: opts.verbose ? 'inherit' : ['ignore', 'pipe', 'pipe'],
          });
          let stderrBuf = '';
          if (!opts.verbose && child.stderr) {
            child.stderr.on('data', (chunk) => { stderrBuf += chunk.toString(); });
          }
          child.on('error', reject);
          child.on('exit', (code) => {
            if (code === 0) resolve();
            else {
              const details = stderrBuf ? `\n\nPython stderr:\n${stderrBuf}` : '';
              reject(new Error(`AutoCrop-vertical plan-only exited with code ${code}.${details}`));
            }
          });
        });
        if (!fs.existsSync(planPath)) {
          throw new Error('AutoCrop-vertical did not write plan file. Ensure setup applied the plan-output patch (re-run npx ffmpeg-framecraft-setup-autocrop).');
        }
        const planRaw = fs.readFileSync(planPath, 'utf8');
        let plan;
        try {
          plan = JSON.parse(planRaw);
        } catch (e) {
          throw new Error(`Invalid plan JSON: ${e.message}`);
        }
        const keyframes = this._autocropPlanToKeyframes(plan);
        const meta = await probe(inputPath);
        const filter = cropTo916DynamicFilter(meta.width, meta.height, keyframes, getVerticalSize(opts.resolution));
        await run({
          input: inputPath,
          output: outputPath,
          videoFilters: filter,
          outputOptions: shortsPreset.outputOptions(opts.quality || 'balanced', {
            crf: opts.crf,
            preset: opts.preset,
          }),
          expectedDuration: meta.duration || undefined,
          onProgress: opts.onProgress,
        });
      } finally {
        try { fs.unlinkSync(planPath); } catch (_) {}
      }
      return;
    }

    await new Promise((resolve, reject) => {
      const child = spawn(pythonCommand, args, {
        cwd: pythonDir,
        stdio: opts.verbose ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      });

      let stderrBuf = '';
      if (!opts.verbose && child.stderr) {
        child.stderr.on('data', (chunk) => {
          stderrBuf += chunk.toString();
        });
      }

      child.on('error', (err) => {
        reject(err);
      });

      child.on('exit', (code) => {
        if (code === 0) {
          resolve();
        } else {
          const details = stderrBuf ? `\n\nPython stderr:\n${stderrBuf}` : '';
          reject(
            new Error(
              `AutoCrop-vertical process exited with code ${code}.${details}`
            )
          );
        }
      });
    });
  }

  /**
   * Convert AutoCrop-vertical plan JSON to keyframes for cropTo916DynamicFilter.
   * Plan format: { width, height, scenes: [ { start, end, strategy, x, w } ] }
   * @param {{ width: number, height: number, scenes: Array<{ start: number, end: number, strategy: string, x: number, w: number }> }} plan
   * @returns {Array<{ t: number, x: number, w: number }>}
   */
  _autocropPlanToKeyframes(plan) {
    const planWidth = Number(plan?.width) || 1920;
    const planHeight = Number(plan?.height) || 1080;
    const cropWDefault = Math.floor((planHeight * 9) / 16) - (Math.floor((planHeight * 9) / 16) % 2);
    const maxXPlan = Math.max(0, planWidth - cropWDefault);
    const widthEven = planWidth - (planWidth % 2);

    const scenes = plan?.scenes;
    if (!Array.isArray(scenes) || scenes.length === 0) {
      const x = Math.max(0, Math.min(maxXPlan, Math.floor((planWidth - cropWDefault) / 2)));
      const xEven = x - (x % 2);
      return [{ t: 0, x: xEven, w: cropWDefault }];
    }
    const keyframes = [];
    for (const s of scenes) {
      const t = Number(s.start);
      let x = Number(s.x) || 0;
      let w = Number(s.w) || cropWDefault;
      w = Math.min(widthEven, Math.max(cropWDefault, w));
      w = w - (w % 2);
      x = Math.max(0, Math.min(maxXPlan, x));
      if (x + w > widthEven) x = Math.max(0, widthEven - w);
      x = x - (x % 2);
      keyframes.push({ t, x, w });
    }
    const last = scenes[scenes.length - 1];
    if (last && Number(last.end) > Number(last.start)) {
      let x = Number(last.x) || 0;
      let w = Number(last.w) || cropWDefault;
      w = Math.min(widthEven, Math.max(cropWDefault, w));
      w = w - (w % 2);
      x = Math.max(0, Math.min(maxXPlan, x));
      if (x + w > widthEven) x = Math.max(0, widthEven - w);
      x = x - (x % 2);
      keyframes.push({ t: last.end, x, w });
    }
    return keyframes;
  }

  async _cropTo916Smart(inputPath, outputPath, meta, opts = {}) {
    const smartSampleEvery = Number.isFinite(opts.smartSampleEvery) ? opts.smartSampleEvery : 0.25;
    const smartTwoShot = opts.smartTwoShot !== false;
    const smartSpeakerBias = opts.smartSpeakerBias !== false;

    let tf;
    let cocoSsd;
    try {
      // Lazy-load so base installs don't break. These are optionalDependencies.
      // eslint-disable-next-line global-require
      tf = require('@tensorflow/tfjs-node');
      // eslint-disable-next-line global-require
      cocoSsd = require('@tensorflow-models/coco-ssd');
    } catch (err) {
      throw new Error(
        "Smart crop requires optional dependencies. Install them with: npm i -S @tensorflow/tfjs-node @tensorflow-models/coco-ssd"
      );
    }

    const model = await cocoSsd.load();

    const width = meta.width;
    const height = meta.height;
    if (!width || !height) throw new Error('Unable to read input dimensions for smart crop');

    const cropWidthRaw = Math.floor((height * 9) / 16);
    const cropWidth = cropWidthRaw - (cropWidthRaw % 2);
    const maxX = Math.max(0, width - cropWidth);
    const fullW = width - (width % 2);

    const duration = meta.duration || 0;
    const sampleEvery = Math.max(0.08, smartSampleEvery);
    const times = [];
    if (duration > 0) {
      for (let t = 0; t < duration; t += sampleEvery) times.push(t);
      if (times.length === 0) times.push(0);
    } else {
      // If duration is unknown, sample first ~20 seconds.
      for (let t = 0; t <= 20; t += sampleEvery) times.push(t);
    }

    const keyframes = [];
    let prevX = Math.floor(maxX / 2);
    let prevW = cropWidth;
    const alphaX = 0.55;

    // Simple track state for speaker bias via mouth-motion.
    // We keep at most 4 tracks and match by IoU.
    /** @type {Array<{ id: number, bbox: number[], mouth?: any, lastMotion: number }>} */
    let tracks = [];
    let nextTrackId = 1;
    let activeSpeakerId = null;
    let activeSpeakerStreak = 0;

    const iou = (a, b) => {
      const ax1 = a[0], ay1 = a[1], ax2 = a[0] + a[2], ay2 = a[1] + a[3];
      const bx1 = b[0], by1 = b[1], bx2 = b[0] + b[2], by2 = b[1] + b[3];
      const ix1 = Math.max(ax1, bx1);
      const iy1 = Math.max(ay1, by1);
      const ix2 = Math.min(ax2, bx2);
      const iy2 = Math.min(ay2, by2);
      const iw = Math.max(0, ix2 - ix1);
      const ih = Math.max(0, iy2 - iy1);
      const inter = iw * ih;
      const areaA = Math.max(0, ax2 - ax1) * Math.max(0, ay2 - ay1);
      const areaB = Math.max(0, bx2 - bx1) * Math.max(0, by2 - by1);
      const denom = areaA + areaB - inter;
      return denom > 0 ? inter / denom : 0;
    };

    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

    const bboxCenterX = (bbox) => bbox[0] + bbox[2] / 2;

    const bboxEnclose = (bboxes) => {
      if (!bboxes.length) return null;
      const x1 = Math.min(...bboxes.map((b) => b[0]));
      const y1 = Math.min(...bboxes.map((b) => b[1]));
      const x2 = Math.max(...bboxes.map((b) => b[0] + b[2]));
      const y2 = Math.max(...bboxes.map((b) => b[1] + b[3]));
      return [x1, y1, x2 - x1, y2 - y1];
    };

    const getMouthPatch = (imgTensor, bbox) => tf.tidy(() => {
      // bbox: [x,y,w,h] in input pixel coords
      const x = clamp(Math.floor(bbox[0]), 0, width - 2);
      const y = clamp(Math.floor(bbox[1]), 0, height - 2);
      const w = clamp(Math.floor(bbox[2]), 2, width - x);
      const h = clamp(Math.floor(bbox[3]), 2, height - y);

      // Approx head box = top 35% of person bbox; mouth = lower portion of head.
      const headH = Math.max(2, Math.floor(h * 0.35));
      const mouthY = y + Math.floor(headH * 0.55);
      const mouthH = Math.max(2, Math.floor(headH * 0.35));
      const mouthX = x + Math.floor(w * 0.15);
      const mouthW = Math.max(2, Math.floor(w * 0.7));

      const mx = clamp(mouthX, 0, width - 2);
      const my = clamp(mouthY, 0, height - 2);
      const mw = clamp(mouthW, 2, width - mx);
      const mh = clamp(mouthH, 2, height - my);

      const patch = imgTensor.slice([my, mx, 0], [mh, mw, 3]);
      const gray = patch.mean(2).div(255.0); // [mh,mw]
      const resized = tf.image.resizeBilinear(gray.expandDims(-1), [64, 64]).squeeze(); // [64,64]
      return resized;
    });

    for (const t of times) {
      const frame = await this._extractJpegFrame(inputPath, t);
      const tensor = tf.node.decodeImage(frame, 3);
      const predictions = await model.detect(tensor);

      const people = predictions
        .filter((p) => p && p.class === 'person' && (p.score ?? 0) >= 0.4 && Array.isArray(p.bbox))
        .map((p) => {
          const [x, y, w, h] = p.bbox;
          const area = Math.max(0, w) * Math.max(0, h);
          return { score: p.score ?? 0, area, bbox: p.bbox };
        })
        .sort((a, b) => (b.area * b.score) - (a.area * a.score));

      // Keep only top N persons to limit work.
      const persons = people.slice(0, 4).map((p) => p.bbox);

      // Update / create tracks by IoU matching.
      const usedTrackIds = new Set();
      const newTracks = [];
      for (const bbox of persons) {
        let best = null;
        let bestIou = 0;
        for (const tr of tracks) {
          if (usedTrackIds.has(tr.id)) continue;
          const score = iou(tr.bbox, bbox);
          if (score > bestIou) {
            bestIou = score;
            best = tr;
          }
        }
        if (best && bestIou >= 0.15) {
          usedTrackIds.add(best.id);
          newTracks.push({ ...best, bbox });
        } else {
          const id = nextTrackId++;
          newTracks.push({ id, bbox, mouth: null, lastMotion: 0 });
        }
      }

      // Compute mouth-motion per track (heuristic for speaking).
      if (smartSpeakerBias) {
        for (const tr of newTracks) {
          const patch = getMouthPatch(tensor, tr.bbox);
          let motion = 0;
          if (tr.mouth) {
            motion = tf.tidy(() => patch.sub(tr.mouth).abs().mean().dataSync()[0]);
            try { tr.mouth.dispose(); } catch (_) {}
          }
          tr.mouth = patch;
          tr.lastMotion = Number.isFinite(motion) ? motion : 0;
        }
      }

      // Speaker selection with hysteresis.
      let speaker = null;
      if (smartSpeakerBias && newTracks.length > 0) {
        const sortedByMotion = [...newTracks].sort((a, b) => (b.lastMotion || 0) - (a.lastMotion || 0));
        const top = sortedByMotion[0];
        const topMotion = top?.lastMotion ?? 0;
        // Require a bit of motion to switch; mouth ROI is noisy.
        const motionThreshold = 0.010;
        if (top && topMotion >= motionThreshold) {
          if (activeSpeakerId === top.id) {
            activeSpeakerStreak++;
          } else {
            // Switch only after 2 consecutive wins.
            if (activeSpeakerStreak >= 1) {
              activeSpeakerId = top.id;
              activeSpeakerStreak = 0;
            } else {
              activeSpeakerStreak = 1;
            }
          }
        }
        speaker = newTracks.find((tr) => tr.id === activeSpeakerId) || top;
      }

      // Decide framing: track single, keep-two (if fits), or letterbox.
      let desiredW = cropWidth;
      let xRaw = Math.floor(maxX / 2);

      if (newTracks.length === 0) {
        // Letterbox when no people.
        desiredW = fullW;
        xRaw = 0;
      } else if (!smartTwoShot || newTracks.length === 1) {
        const target = speaker || newTracks[0];
        const cx = bboxCenterX(target.bbox);
        desiredW = cropWidth;
        xRaw = Math.round(cx - cropWidth / 2);
      } else {
        // Two-shot: keep the top two tracks (by area proxy = bbox area).
        const topTwo = [...newTracks]
          .sort((a, b) => (b.bbox[2] * b.bbox[3]) - (a.bbox[2] * a.bbox[3]))
          .slice(0, 2);
        const group = bboxEnclose(topTwo.map((t2) => t2.bbox));
        const groupSpan = group ? group[2] : cropWidth;

        if (group && groupSpan <= cropWidth) {
          desiredW = cropWidth;
          const groupLeft = group[0];
          const groupRight = group[0] + group[2];
          const minXAllowed = clamp(Math.round(groupRight - cropWidth), 0, maxX);
          const maxXAllowed = clamp(Math.round(groupLeft), 0, maxX);

          const sp = speaker && topTwo.find((t2) => t2.id === speaker.id) ? speaker : null;
          const focus = sp ? bboxCenterX(sp.bbox) : (groupLeft + groupRight) / 2;
          // Put speaker slightly toward the left third (classic talking-head framing),
          // but clamp to keep both people within the crop window.
          const desiredX = Math.round(focus - cropWidth * 0.35);
          xRaw = clamp(desiredX, minXAllowed, maxXAllowed);
        } else {
          // If two people don't fit, preserve the full shot via letterbox.
          desiredW = fullW;
          xRaw = 0;
        }
      }

      // Smooth x to avoid jitter; keep even.
      xRaw = clamp(xRaw, 0, Math.max(0, width - desiredW));
      const smoothedX = Math.round(prevX + alphaX * (xRaw - prevX));
      const evenX = smoothedX - (smoothedX % 2);
      prevX = clamp(evenX, 0, Math.max(0, width - desiredW));
      prevW = desiredW;

      keyframes.push({ t: Number(t.toFixed(3)), x: prevX, w: prevW });

      // Dispose frame tensor and keep track state.
      tensor.dispose();
      // Keep only recent tracks, and dispose mouth tensors we won't keep.
      for (const old of tracks) {
        if (!newTracks.find((nt) => nt.id === old.id) && old.mouth) {
          try { old.mouth.dispose(); } catch (_) {}
        }
      }
      tracks = newTracks.slice(0, 4);
    }

    // Reduce keyframes a bit (avoid huge expressions): keep only those that change meaningfully.
    const compact = [];
    for (const k of keyframes) {
      const last = compact[compact.length - 1];
      if (!last || Math.abs(k.x - last.x) >= 8 || Math.abs((k.w ?? cropWidth) - (last.w ?? cropWidth)) >= 8) {
        compact.push(k);
      }
    }
    if (compact.length === 0) compact.push({ t: 0, x: Math.floor(maxX / 2), w: cropWidth });

    const filter = cropTo916DynamicFilter(width, height, compact, getVerticalSize(opts.resolution));
    await run({
      input: inputPath,
      output: outputPath,
      videoFilters: filter,
      outputOptions: shortsPreset.outputOptions(opts.quality, { crf: opts.crf, preset: opts.preset }),
      expectedDuration: meta.duration || undefined,
      onProgress: opts.onProgress,
    });
  }

  _extractJpegFrame(inputPath, timeSeconds) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      const command = ffmpeg(inputPath)
        .seekInput(Math.max(0, timeSeconds))
        .frames(1)
        .outputOptions(['-f', 'image2pipe', '-vcodec', 'mjpeg', '-q:v', '2'])
        .format('image2pipe');

      const stream = command.pipe();
      stream.on('data', (d) => chunks.push(d));
      stream.on('error', (e) => reject(e));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
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
   * @param {'fast'|'balanced'|'high'} [opts.quality='balanced'] - Encoding quality
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
      outputOptions: shortsPreset.outputOptions(opts.quality, { crf: opts.crf, preset: opts.preset }),
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
   * @param {'fast'|'balanced'|'high'} [opts.quality='balanced'] - Encoding quality
   * @returns {Promise<void>}
   */
  async addSubtitles(inputPath, outputPath, srtPath, opts = {}) {
    const { onProgress, quality, ...style } = opts;
    const filter = subtitleFilter(srtPath, style);

    await run({
      input: inputPath,
      output: outputPath,
      videoFilters: filter,
      outputOptions: shortsPreset.outputOptions(quality),
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
   * @param {'fast'|'balanced'|'high'} [opts.quality='balanced'] - Encoding quality
   * @returns {Promise<void>}
   */
  async addBackgroundMusic(inputPath, outputPath, musicPath, opts = {}) {
    const { onProgress, quality } = opts;
    const meta = await probe(inputPath);
    const filterComplex = amixFilter(meta.hasAudio);

    await run({
      input: inputPath,
      inputs: [musicPath],
      output: outputPath,
      complexFilter: filterComplex,
      complexFilterMap: ['0:v', '[aout]'],
      outputOptions: shortsPreset.outputOptions(quality),
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
   * @param {number} [options.transitionDummyHold=0] - Seconds of frozen frame at each boundary so the transition runs over the hold instead of the live cut (e.g. 1 for smoother result)
   * @param {object} [opts] - Additional options
   * @param {function(object): void} [opts.onProgress] - Progress callback
   * @param {'fast'|'balanced'|'high'} [opts.quality='balanced'] - Encoding quality
   * @returns {Promise<void>}
   */
  async slicesWithTransitions(inputPath, outputPath, options, opts = {}) {
    const { slices, preset, transitionDummyHold } = options;
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
      meta.hasAudio,
      { transitionDummyHold: transitionDummyHold != null ? Number(transitionDummyHold) : 0 }
    );

    const complexFilterMap = [mapVideo];
    if (mapAudio) complexFilterMap.push(mapAudio);

    await run({
      input: inputPath,
      output: outputPath,
      complexFilter: filterComplex,
      complexFilterMap,
      outputOptions: shortsPreset.outputOptions(opts.quality, { crf: opts.crf, preset: opts.preset }),
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
   * @param {'fast'|'balanced'|'high'} [opts.quality='balanced'] - Encoding quality
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
            transitionDummyHold: step.transitionDummyHold,
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
