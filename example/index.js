const path = require('path');

const { FramecraftEngine, composeShorts } = require('..');
const { PRESETS: TRANSITION_PRESETS } = require('../src/presets/transitions');
const engine = new FramecraftEngine();

// const inputPath = path.join(__dirname, '../demos/data/input.mp4');
const inputPath = path.join(__dirname, '../example/media/input.mp4');
const outputPath = path.join(__dirname, '../example/media/output.mp4');

// const inputPath = path.join(__dirname, '../example/media/output.mp4');
// const outputPath = path.join(__dirname, '../example/media/output_916.mp4');


const extractAudio = async () => {
  engine.compose(inputPath, outputPath, [
    { op: 'slice', start: 10, end: 60 },
    { op: 'audioOnly', outputPath: path.join(__dirname, '../example/media/output_audio.mp3') },
  ], {
    onProgress: (p) => {
      console.log('Progress:', p.percent?.toFixed(1) + '%');
    },
  }).then(() => {
    console.log('Compose completed');
  }).catch((err) => {
    console.error('Error:', err);
  });
}

const slicesWithTransitions = async () => {
  engine.compose(inputPath, outputPath, [
    {
      op: 'slicesWithTransitions', slices: [
        { start: 18, end: 28 },
        { start: 86, end: 98, transition: TRANSITION_PRESETS.fadeLong },
        { start: 207, end: 219, transition: TRANSITION_PRESETS.fadeLong },
      ], preset: 'youtubeShort'
    },
  ], {
    onProgress: (p) => {
      console.log('Progress:', p.percent?.toFixed(1) + '%');
    },
  }).then(() => {
    console.log('Compose completed');
  }).catch((err) => {
    console.error('Error:', err);
  });
}

const sliceVideo = async () => {
  try {
    await engine.slice(inputPath, outputPath, {
      start: 0,
      end: 120,
    });
    console.log('Slice video completed');
  } catch (err) {
    console.error('Error:', err);
  }
}

const cropTo916 = async () => {
  try {
    await engine.cropTo916AutoCropVertical(inputPath, outputPath, {
      pythonDir: path.join(__dirname, '../autocrop-vertical'),
      pythonCommand: path.join(__dirname, '../autocrop-vertical', '.venv', 'bin', 'python3.9'),
      ratio: '9:16',
      quality: 'high',
      encoder: 'auto',
      // encodeWithFramecraft: true,  // use AutoCrop plan-only + Node encode (single pass, better quality)
      // frameSkip: 0,
      // downscale: 0,
    });
    console.log('Crop to 9:16 completed');
  } catch (err) {
    console.error('Error:', err);
  }
}

const cropTo916Smart = async () => {
  try {
    await engine._cropTo916Smart(inputPath, outputPath, {
      smart: true,
      smartTwoShot: true,
      smartSpeakerBias: true,
      smartSampleEvery: 0.15,
    });
    console.log('Crop to 9:16 smart completed');
  } catch (err) {
    console.error('Error:', err);
  }
}

const runComposeShorts = async () => {
  await composeShorts(engine, inputPath, outputPath, {
    cropMode: 'autocrop', // or 'smart' or 'static'
    quality: 'max',
    slices: [
      { start: 0, end: 20 },
      { start: 25, end: 35, transition: TRANSITION_PRESETS.fadeblack },
      { start: 35, end: 52, transition: TRANSITION_PRESETS.fadeblack },
    ],
    transitionDummyHold: 1, // 1s frozen frame at each cut for smoother transitions
    // subtitles: { srtPath: 'subs.srt' },
    // music: { musicPath: 'bgm.mp3' },
    autocrop: {
      ratio: '9:16',
      quality: 'max',
      encoder: 'auto',
      // encodeWithFramecraft: true,  // plan-only + Node encode for better quality (requires setup patch)
      // resolution: '720',
      pythonDir: path.join(__dirname, '../autocrop-vertical'),
      pythonCommand: path.join(__dirname, '../autocrop-vertical', '.venv', 'bin', 'python3.9')
    },
    onProgress: (p) => console.log(p.percent?.toFixed(1) ?? '-', '%'),
  });
  console.log('Compose shorts completed');
}
// extractAudio(); // example 1 extract audio from 10 to 20 seconds
// slicesWithTransitions(); // example 2 extract 0 to 5 seconds, 5 to 11 seconds with wipedown transition, 11 to 15 seconds with distance transition
// cropTo916Smart(); // example 4 crop to 9:16 using AutoCrop-vertical smart
// cropTo916(); // example 3 crop to 9:16 using AutoCrop-vertical
// sliceVideo(); // example 5 slice video from 0 to 60 seconds
runComposeShorts(); // example 6 compose shorts