// Readings of the measured data. Every number is taken from benchmarks.js, so these
// sentences stay true when the data is regenerated; a configuration that was not
// measured is left out rather than described.
import { compare, resolutions, showcase } from './benchmarks.js';

const res = (r) => r.replace('x', '×');
const get = (r, mode, count, engine) => showcase[r]?.[mode]?.[count]?.[engine] ?? null;
const measured = (mode, count) => resolutions.filter((r) => ['batched', 'webgpu', 'webgl'].every((e) => get(r, mode, count, e)));
const range = (values, digits = 1) => {
  const lo = Math.min(...values).toFixed(digits), hi = Math.max(...values).toFixed(digits);
  return lo === hi ? lo : `${lo} to ${hi}`;
};

function showcaseFindings() {
  const out = [];

  const sep = measured('objects', 10000);
  if (sep.length) {
    const fps = (e) => range(sep.map((r) => get(r, 'objects', 10000, e).fps));
    const ratio = (e) => range(sep.map((r) => get(r, 'objects', 10000, e).submit / get(r, 'objects', 10000, 'batched').submit));
    out.push(['Separate meshes, 10,000 bodies.', `Across ${sep.map(res).join(', ')}: WAMR3D batched ran at ${fps('batched')} fps, three.js at ${fps('webgl')} (WebGL) and ${fps('webgpu')} (WebGPU). WAMR3D submitted draws ${ratio('webgl')}× faster than three.js WebGL and ${ratio('webgpu')}× faster than three.js WebGPU.`]);
  }

  // WAMR3D on its WebGL 2 renderer against three.js on WebGL: the same graphics API on both sides.
  const gl = resolutions.filter((r) => get(r, 'objects', 10000, 'batched-webgl') && get(r, 'objects', 10000, 'webgl'));
  if (gl.length) {
    const fps = (e) => range(gl.map((r) => get(r, 'objects', 10000, e).fps));
    const cpu = (e) => range(gl.map((r) => get(r, 'objects', 10000, e).update + get(r, 'objects', 10000, e).submit));
    out.push(['WebGL 2 against WebGL, 10,000 bodies.', `For machines without WebGPU. Across ${gl.map(res).join(', ')}: WAMR3D batched on its WebGL 2 renderer ran at ${fps('batched-webgl')} fps and spent ${cpu('batched-webgl')} ms of CPU per frame; three.js WebGL ran at ${fps('webgl')} fps with ${cpu('webgl')} ms.`]);
  }

  const inst = measured('instanced', 50000);
  if (inst.length) {
    const f = (e, k) => range(inst.map((r) => get(r, 'instanced', 50000, e)[k]));
    const speed = (e) => range(inst.map((r) => get(r, 'instanced', 50000, e).update / get(r, 'instanced', 50000, 'batched').update));
    out.push(['Instanced, 50,000 bodies.', `With five draw calls the scene-graph update decides. WAMR3D batched ran at ${f('batched', 'fps')} fps, three.js at ${f('webgpu', 'fps')} (WebGPU) and ${f('webgl', 'fps')} (WebGL); WAMR3D updated the scene ${speed('webgpu')}× and ${speed('webgl')}× faster (${f('batched', 'update')} ms against ${f('webgpu', 'update')} and ${f('webgl', 'update')} ms).`]);
  }

  const all = resolutions.filter((r) => get(r, 'instanced', 2000, 'batched') && get(r, 'instanced', 2000, 'webgl'));
  const lowest = resolutions.find((r) => get(r, 'objects', 2000, 'batched'));
  const highest = [...resolutions].reverse().find((r) => get(r, 'objects', 2000, 'batched'));
  const parts = [];
  if (all.length) {
    const fps = all.flatMap((r) => ['batched', 'object', 'webgpu', 'webgl'].map((e) => get(r, 'instanced', 2000, e)?.fps).filter((v) => v !== undefined));
    parts.push(`At 2,000 instanced bodies every engine ran at ${range(fps)} fps, and three.js WebGL submitted draws in ${range(all.map((r) => get(r, 'instanced', 2000, 'webgl').submit))} ms against ${range(all.map((r) => get(r, 'instanced', 2000, 'batched').submit))} ms for WAMR3D.`);
  }
  if (lowest && highest && lowest !== highest) parts.push(`At 2,000 separate bodies WAMR3D batched submitted in ${get(lowest, 'objects', 2000, 'batched').submit.toFixed(1)} ms at ${res(lowest)} and ${get(highest, 'objects', 2000, 'batched').submit.toFixed(1)} ms at ${res(highest)}.`);
  if (parts.length) out.push(['Where the gap closes.', parts.join(' ')]);

  return out;
}

function compareFindings() {
  const out = [];
  for (const r of resolutions) {
    const rows = compare[r];
    if (!rows?.length) continue;
    const find = (objects, engine) => rows.find((x) => x.objects === objects && x.engine === engine);
    const three = find(10004, 'three'), wamr = find(10004, 'wamr3d'), api = find(10007, 'api'), webgl = find(10007, 'three-webgl'), webgpu = find(10007, 'three-webgpu');
    const parts = [];
    if (three && wamr) parts.push(`same three.js WebGL renderer, only the transforms differ: WAMR3D updated 10,004 objects ${(three.update / wamr.update).toFixed(1)}× faster (${wamr.update.toFixed(1)} ms against ${three.update.toFixed(1)} ms)`);
    if (api && webgl && webgpu) parts.push(`same scene code at 10,007 objects: WAMR3D object API ${api.fps} fps, three.js ${webgl.fps} fps (WebGL) and ${webgpu.fps} fps (WebGPU)`);
    if (parts.length) out.push(`<strong class="text-slate-200">${res(r)}:</strong> ${parts.join('; ')}.`);
  }
  return out;
}

export const findings = { showcase: showcaseFindings(), compare: compareFindings() };
