const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const {
  cropTo916Filter,
  subtitleFilter,
  amixFilter,
  SHORTS_WIDTH,
  SHORTS_HEIGHT,
} = require('../src/filters');

describe('cropTo916Filter', () => {
  it('produces crop,scale chain for 1920x1080', () => {
    const filter = cropTo916Filter(1920, 1080);
    assert.match(filter, /crop=\d+:\d+:\d+:\d+/);
    assert.match(filter, /scale=720:1280/);
    const cropMatch = filter.match(/crop=(\d+):(\d+):(\d+):(\d+)/);
    assert.ok(cropMatch);
    const [, w, h, x, y] = cropMatch.map(Number);
    assert.strictEqual(w, 607);
    assert.strictEqual(h, 1080);
    assert.strictEqual(x, 656);
    assert.strictEqual(y, 0);
  });

  it('produces correct crop for 1280x720', () => {
    const filter = cropTo916Filter(1280, 720);
    const cropMatch = filter.match(/crop=(\d+):(\d+):(\d+):(\d+)/);
    assert.ok(cropMatch);
    const [, w, h, x] = cropMatch.map(Number);
    assert.strictEqual(w, 405);
    assert.strictEqual(h, 720);
    assert.strictEqual(x, 437);
  });

  it('scales to SHORTS_WIDTH x SHORTS_HEIGHT', () => {
    const filter = cropTo916Filter(100, 100);
    assert.ok(filter.includes(`scale=${SHORTS_WIDTH}:${SHORTS_HEIGHT}`));
  });
});

describe('subtitleFilter', () => {
  it('returns subtitles filter with escaped path', () => {
    const filter = subtitleFilter('/tmp/subs.srt');
    assert.ok(filter.startsWith("subtitles='"));
    assert.ok(filter.includes('/tmp/subs.srt'));
  });

  it('appends force_style when style options provided', () => {
    const filter = subtitleFilter('/path/subs.srt', {
      fontSize: 24,
      primaryColour: '&Hffffff',
    });
    assert.ok(filter.includes('force_style'));
    assert.ok(filter.includes('FontSize=24'));
    assert.ok(filter.includes('PrimaryColour=&Hffffff'));
  });

  it('escapes path for Windows-style paths', () => {
    const filter = subtitleFilter('C:\\subs\\file.srt');
    assert.ok(filter.includes('\\\\'));
  });
});

describe('amixFilter', () => {
  it('returns amix when video has audio', () => {
    const filter = amixFilter(true);
    assert.strictEqual(
      filter,
      '[0:a][1:a]amix=inputs=2:duration=shortest[aout]'
    );
  });

  it('returns anull passthrough when video has no audio', () => {
    const filter = amixFilter(false);
    assert.strictEqual(filter, '[1:a]anull[aout]');
  });
});

describe('constants', () => {
  it('SHORTS_WIDTH is 720', () => {
    assert.strictEqual(SHORTS_WIDTH, 720);
  });
  it('SHORTS_HEIGHT is 1280', () => {
    assert.strictEqual(SHORTS_HEIGHT, 1280);
  });
});
