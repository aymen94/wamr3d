// Turns the raw logs of one benchmark run into website/src/data/benchmarks.js.
//   node website/scripts/benchmark-data.mjs bench/results/<date>
// The logs come from bench/bench.mjs, bench/compat.mjs, examples/showcase/check.mjs --measure
// and examples/compare/measure.mjs --gpu (commands on the benchmarks page). A configuration
// that is missing or did not parse is listed in `failures` rather than filled in.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dir = resolve(process.argv[2] ?? '');
if (!process.argv[2] || !existsSync(dir)) {
  console.error('usage: node website/scripts/benchmark-data.mjs bench/results/<date>');
  process.exit(1);
}

const resolutions = ['1280x720', '1920x1080', '2560x1440', '3840x2160'];
const engineIds = { 'WAMR3D · batched API': 'batched', 'WAMR3D · object API': 'object', 'three.js r186 · WebGPU': 'webgpu', 'three.js r186 · WebGL': 'webgl' };
const failures = [];
const read = (name) => {
  const path = join(dir, name);
  const text = existsSync(path) ? readFileSync(path, 'utf8').replace(/\r/g, '') : '';
  if (!text.trim()) failures.push(`${name}: no output`);
  return text;
};
const num = (s) => Number(s);

const meta = { date: basename(dir), dir: relative(root, dir).replaceAll('\\', '/'), canvases: {} };

// Showcase: bodies, mode, renderer, fps, frame, update, submit, calls, build.
const showcase = {};
const showcaseRow = /^\s*(\d+)\s+(objects|instanced)\s+(.+?)\s{2,}([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+(\d+)\s*$/;
for (const r of resolutions) {
  for (const file of [`showcase-${r}.txt`, `showcase100k-${r}.txt`]) {
    const text = read(file);
    const head = text.split('\n')[0].match(/^(Chrome\/[\d.]+), (.+?); window/);
    if (head) [, meta.chrome, meta.cpu] = head;
    const canvas = text.match(/canvas (\d+x\d+), device pixel ratio/);
    if (canvas) meta.canvases[r] = [...new Set([...(meta.canvases[r] ?? []), canvas[1]])];
    for (const line of text.split('\n')) {
      const m = line.match(showcaseRow);
      if (!m) {
        if (/fail|error/i.test(line)) failures.push(`${file}: ${line.trim()}`);
        continue;
      }
      const engine = engineIds[m[3].trim()];
      if (!engine) { failures.push(`${file}: unknown renderer "${m[3].trim()}"`); continue; }
      ((showcase[r] ??= {})[m[2]] ??= {})[m[1]] ??= {};
      showcase[r][m[2]][m[1]][engine] = { fps: num(m[4]), frame: num(m[5]), update: num(m[6]), submit: num(m[7]), calls: num(m[8]), build: num(m[9]) };
    }
  }
  for (const [mode, counts] of [['objects', [2000, 10000, 50000]], ['instanced', [2000, 10000, 50000, 100000]]]) {
    for (const count of counts) {
      const missing = Object.values(engineIds).filter((e) => !showcase[r]?.[mode]?.[count]?.[e]);
      if (missing.length) failures.push(`showcase ${r}, ${count} ${mode}: no result for ${missing.join(', ')}`);
    }
  }
}

// Comparison scene.
const compare = {};
const compareRow = /^\s*(\d+)\s+(\S+)\s+(\d+)\s+([\d.]+) \/ ([\d.]+)\s+(\d+)\s+([\d.]+) \/ ([\d.]+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(.+?)\s*$/;
for (const r of resolutions) {
  const text = read(`compare-${r}.txt`);
  const gpu = text.match(/^GPU: (.+)$/m);
  if (gpu) meta.gpu = gpu[1];
  compare[r] = text.split('\n').map((line) => line.match(compareRow)).filter(Boolean).map((m) => ({
    objects: num(m[1]), engine: m[2], frames: num(m[3]), frame: num(m[4]), frameP95: num(m[5]), fps: num(m[6]),
    update: num(m[7]), updateP95: num(m[8]), submit: num(m[9]), firstFrame: num(m[10]), wasmInit: m[11] === '-' ? null : num(m[11]), name: m[12].replace(' r186', '')
  }));
  if (text && !compare[r].length) failures.push(`compare-${r}.txt: no rows`);
}

// Node.js microbenchmarks: [workload, three.js ms, WAMR3D ms].
const benchText = read('bench.txt');
const env = benchText.match(/^node (v[\d.]+), (\w+) (\w+)/);
if (env) {
  meta.node = env[1];
  meta.os = `${{ win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[env[2]] ?? env[2]} ${env[3]}`;
}
const lowLevel = [];
let pending = null;
for (const line of benchText.split('\n')) {
  const three = line.match(/^(\S.*?)\s+three\s+([\d.]+)\s/);
  const wamr = line.match(/^\s+wamr3d\s+([\d.]+)\s/);
  if (three) pending = [three[1].trim(), num(three[2])];
  else if (wamr && pending) { lowLevel.push([...pending, num(wamr[1])]); pending = null; }
}
const init = benchText.match(/wamr3d: import ([\d.]+) ms, init \(compile \+ instantiate (\d+) KiB of wasm\) ([\d.]+) ms/);
const startup = init ? { wamrImport: num(init[1]), wasmKiB: num(init[2]), wamrInit: num(init[3]) } : null;

const objectApi = read('compat.txt').split('\n').map((line) => line.match(/^(\S.*?)\s{2,}([\d.]+)\s+([\d.]+)\s+[\d.]+x\s*$/)).filter(Boolean).map((m) => [m[1].trim(), num(m[2]), num(m[3])]);

const json = (v) => JSON.stringify(v);
writeFileSync(join(root, 'website/src/data/benchmarks.js'), `// Generated by website/scripts/benchmark-data.mjs from ${meta.dir}/. Do not edit by hand.

export const meta = ${JSON.stringify(meta, null, 2)};

export const resolutions = ${json(resolutions)};

export const engines = [
  { id: 'batched', label: 'WAMR3D · batched API', short: 'WAMR3D batched', series: 1 },
  { id: 'object', label: 'WAMR3D · object API', short: 'WAMR3D object API', series: 2 },
  { id: 'webgpu', label: 'three.js · WebGPU', short: 'three.js WebGPU', series: 3 },
  { id: 'webgl', label: 'three.js · WebGL', short: 'three.js WebGL', series: 4 }
];

// examples/showcase/check.mjs --measure --size=WxH (plus --counts=100000 --modes=instanced).
// showcase[resolution][mode][bodies][engine] = { fps, frame, update, submit, calls, build } (ms).
export const showcase = ${json(showcase)};

// examples/compare/measure.mjs --gpu --size=WxH. Medians unless named p95.
export const compare = ${json(compare)};

// node bench/bench.mjs: [workload, three.js median ms, WAMR3D median ms].
export const lowLevel = ${json(lowLevel)};
export const startup = ${json(startup)};

// node bench/compat.mjs: [workload, three.js median ms, WAMR3D median ms].
export const objectApi = ${json(objectApi)};

export const failures = ${json(failures)};
`);
console.log(`wrote website/src/data/benchmarks.js from ${meta.dir}: ${lowLevel.length} + ${objectApi.length} Node.js rows, ${failures.length} failures`);
for (const f of failures) console.log(`  ${f}`);
