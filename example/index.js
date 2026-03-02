const path = require('path');

const { FramecraftEngine } = require('..');
const engine = new FramecraftEngine();

const inputPath = path.join(__dirname, '../example/media/sample.mp4');
const outputPath = path.join(__dirname, '../example/media/output.mp4');


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
    { op: 'slicesWithTransitions', slices: [
      { start: 18, end: 28 },
      { start: 86, end: 98, transition: { type: 'dissolve', duration: 1 } },
      { start: 207, end: 219, transition: { type: 'distance', duration: 1 } },
    ], preset: 'youtubeShort' },
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

// extractAudio(); // example 1 extract audio from 10 to 20 seconds
slicesWithTransitions(); // example 2 extract 0 to 5 seconds, 5 to 11 seconds with wipedown transition, 11 to 15 seconds with distance transition