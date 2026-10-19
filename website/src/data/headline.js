// The headline figures of the site, picked from the measured data in benchmarks.js: the
// largest lead of WAMR3D over three.js on the same graphics API. Both always carry the
// configuration they were measured in, so a claim never appears without its condition.
import { compare, resolutions, showcase } from './benchmarks.js';

const pairs = [['batched', 'webgpu', 'WebGPU'], ['batched-webgl', 'webgl', 'WebGL 2']];
const res = (r) => r.replace('x', '×');

// Frame rate: the showcase, WAMR3D batched against three.js on the same backend.
function fastestFrameRate() {
  let best = null;
  for (const r of resolutions) {
    for (const [mode, counts] of Object.entries(showcase[r] ?? {})) {
      for (const [count, row] of Object.entries(counts)) {
        for (const [wamrId, threeId, api] of pairs) {
          const wamr = row[wamrId], three = row[threeId];
          if (!wamr || !three) continue;
          const ratio = wamr.fps / three.fps;
          if (!best || ratio > best.ratio) best = { ratio, resolution: res(r), count: Number(count), what: mode === 'objects' ? 'separate meshes' : 'instanced bodies', api, wamr: wamr.fps, three: three.fps };
        }
      }
    }
  }
  return best;
}

// CPU draw submission: the comparison scene, WAMR3D on WebGPU against three.js on WebGPU.
function fastestSubmission() {
  let best = null;
  for (const r of resolutions) {
    for (const wamr of (compare[r] ?? []).filter((x) => x.engine === 'native' && x.objects > 100)) {
      const three = compare[r].find((x) => x.engine === 'three-webgpu' && Math.abs(x.objects - wamr.objects) < 10);
      if (!three || !wamr.submit) continue;
      const ratio = three.submit / wamr.submit;
      if (!best || ratio > best.ratio) best = { ratio, resolution: res(r), count: wamr.objects, wamr: wamr.submit, three: three.submit };
    }
  }
  return best;
}

export const frameRateLead = fastestFrameRate();
export const submissionLead = fastestSubmission();

// One line for titles and descriptions, e.g. "up to 6.7× faster than three.js".
export const headlineShort = frameRateLead ? `up to ${frameRateLead.ratio.toFixed(1)}× faster than three.js` : '';
export const headlineDetail = frameRateLead
  ? `${frameRateLead.count.toLocaleString('en-US')} ${frameRateLead.what} at ${frameRateLead.resolution} on ${frameRateLead.api}: ${frameRateLead.wamr.toFixed(1)} fps against ${frameRateLead.three.toFixed(1)} fps for three.js`
  : '';
