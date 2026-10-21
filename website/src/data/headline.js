// The headline figures of the site, picked from the measured data in benchmarks.js: the
// largest lead of WAMR3D over three.js on the same graphics API. Both always carry the
// configuration they were measured in, so a claim never appears without its condition.
import { compare, lowLevel, resolutions, showcase } from './benchmarks.js';

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

// Scene update (animation, transforms, world matrices): the showcase, WAMR3D batched against the
// faster of the two three.js renderers, so the lead never depends on three.js's slower backend.
function fastestUpdate() {
  let best = null;
  for (const r of resolutions) {
    for (const [mode, counts] of Object.entries(showcase[r] ?? {})) {
      for (const [count, row] of Object.entries(counts)) {
        const three = [row.webgpu, row.webgl].filter(Boolean).sort((a, b) => a.update - b.update)[0];
        if (!row.batched?.update || !three) continue;
        const ratio = three.update / row.batched.update;
        if (!best || ratio > best.ratio) best = { ratio, resolution: res(r), count: Number(count), what: mode === 'objects' ? 'separate meshes' : 'instanced bodies', wamr: row.batched.update, three: three.update };
      }
    }
  }
  return best;
}

// First frame: the comparison scene, WAMR3D on WebGPU against three.js on WebGPU.
function fastestFirstFrame() {
  let best = null;
  for (const r of resolutions) {
    for (const wamr of (compare[r] ?? []).filter((x) => x.engine === 'native' && x.objects > 100)) {
      const three = compare[r].find((x) => x.engine === 'three-webgpu' && Math.abs(x.objects - wamr.objects) < 10);
      if (!three || !wamr.firstFrame) continue;
      const ratio = three.firstFrame / wamr.firstFrame;
      if (!best || ratio > best.ratio) best = { ratio, resolution: res(r), count: wamr.objects, wamr: wamr.firstFrame, three: three.firstFrame };
    }
  }
  return best;
}

// Object churn: the Node.js low-level benchmark. three.js frees its objects through the garbage
// collector outside the timed region, so the detail says so wherever the figure appears.
function churn() {
  const row = lowLevel.find(([name]) => name.startsWith('scene: create + parent + destroy'));
  return row ? { ratio: row[1] / row[2], three: row[1], wamr: row[2] } : null;
}

export const frameRateLead = fastestFrameRate();
export const churnLead = churn();
export const submissionLead = fastestSubmission();
export const updateLead = fastestUpdate();
export const firstFrameLead = fastestFirstFrame();

// The figures shown next to the headline, largest lead first; each says where it was measured.
const n = (v) => v.toLocaleString('en-US');
export const leads = [
  submissionLead && { ratio: submissionLead.ratio, label: 'Draw submission', detail: `${n(submissionLead.count)} objects at ${submissionLead.resolution}, WebGPU: ${submissionLead.wamr.toFixed(1)} ms against ${submissionLead.three.toFixed(1)} ms` },
  firstFrameLead && { ratio: firstFrameLead.ratio, label: 'First frame', detail: `${n(firstFrameLead.count)} objects at ${firstFrameLead.resolution}, WebGPU: ${Math.round(firstFrameLead.wamr)} ms against ${Math.round(firstFrameLead.three)} ms` },
  updateLead && { ratio: updateLead.ratio, label: 'Scene update', detail: `${n(updateLead.count)} ${updateLead.what} at ${updateLead.resolution}: ${updateLead.wamr.toFixed(1)} ms against ${updateLead.three.toFixed(1)} ms for the faster three.js renderer` },
  churnLead && { ratio: churnLead.ratio, label: 'Spawn + destroy 10K objects', detail: `Create, parent and destroy 10,000 scene objects in Node.js: ${churnLead.wamr.toFixed(2)} ms against ${churnLead.three.toFixed(2)} ms for three.js, whose garbage collection runs outside the timed region` }
].filter((x) => x && x.ratio > 1).sort((a, b) => b.ratio - a.ratio);

// One line for titles and descriptions, e.g. "up to 8.0× faster than three.js".
export const headlineShort = frameRateLead ? `up to ${frameRateLead.ratio.toFixed(1)}× faster than three.js` : '';
export const headlineDetail = frameRateLead
  ? `${frameRateLead.count.toLocaleString('en-US')} ${frameRateLead.what} at ${frameRateLead.resolution} on ${frameRateLead.api}: ${frameRateLead.wamr.toFixed(1)} fps against ${frameRateLead.three.toFixed(1)} fps for three.js`
  : '';
