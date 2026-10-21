// Turns the raw logs of the last benchmark run into website/src/data/benchmarks.js.
//   node website/scripts/benchmark-data.mjs [bench/results]
// bench/results/ holds one run, replaced by the next (bench/run-browser.ps1); run this right
// after a run, since the dates shown come from the log files' modification times. The logs come from bench/bench.mjs, bench/compat.mjs, bench/math.mjs, examples/showcase/check.mjs --measure
// and examples/compare/measure.mjs --gpu (commands on the benchmarks page). A configuration
// that is missing or did not parse is listed in `failures` rather than filled in.
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dir = resolve(root, process.argv[2] ?? 'bench/results');
if (!existsSync(dir)) {
  console.error('usage: node website/scripts/benchmark-data.mjs [bench/results]');
  process.exit(1);
}

// A run may cover only some of these sizes: a size without a showcase log is left out of the site,
// and a suite not run at a measured size is listed in meta.skipped rather than in failures.
const allResolutions = ['1280x720', '1920x1080', '2560x1440', '3840x2160'];
const resolutions = allResolutions.filter((r) => existsSync(join(dir, `showcase-${r}.txt`)));
const engineIds = { 'WAMR3D · batched API': 'batched', 'WAMR3D · object API': 'object', 'WAMR3D · JS math + WebGPU': 'mix', 'WAMR3D · batched API · WebGL': 'batched-webgl', 'WAMR3D · object API · WebGL': 'object-webgl', 'WAMR3D · JS math + WebGL': 'mix-webgl', 'three.js · WebGPU': 'webgpu', 'three.js · WebGL': 'webgl' };
// Logs from before the WebGL 2 backend or the wamr3d/math entry have no rows for these; they are not reported missing.
const optionalEngines = [ 'mix', 'batched-webgl', 'object-webgl', 'mix-webgl' ];
// Logs may name three.js with its revision ("three.js rNNN"); the site shows the name alone.
const withoutRevision = ( name ) => name.replace( / r\d+\b/, '' );
const failures = [];
const read = (name) => {
  const path = join(dir, name);
  // PowerShell redirection writes UTF-16 with a byte-order mark, and piping Node's UTF-8 through a
  // code page 437 console turns "·" into "┬╖".
  const bytes = existsSync(path) ? readFileSync(path) : null;
  const text = !bytes ? '' : (bytes[0] === 0xff && bytes[1] === 0xfe ? bytes.toString('utf16le') : bytes.toString('utf8')).replace(/^﻿/, '').replace(/\r/g, '').replaceAll('┬╖', '·');
  if (!text.trim()) failures.push(`${name}: no output`);
  return text;
};
const num = (s) => Number(s);

const meta = { date: null, dir: relative(root, dir).replaceAll('\\', '/'), canvases: {}, skipped: [] };
const ran = (name) => existsSync(join(dir, name)) || (meta.skipped.push(name), false);
// The day each kind of log was written (local time), from the files themselves.
const written = (names) => [...new Set(names.filter((n) => existsSync(join(dir, n))).map((n) => {
  const d = statSync(join(dir, n)).mtime;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}))].sort();
meta.recorded = { browser: written(resolutions.flatMap((r) => [`showcase-${r}.txt`, `showcase100k-${r}.txt`, `compare-${r}.txt`])), node: written(['bench.txt', 'compat.txt', 'math.txt']) };
// The run's date: the first day any of its logs was written.
meta.date = [...meta.recorded.browser, ...meta.recorded.node].sort()[0] ?? null;

// Showcase: bodies, mode, renderer, fps, frame, update, submit, calls, build.
const showcase = {};
const showcaseRow = /^\s*(\d+)\s+(objects|instanced)\s+(.+?)\s{2,}([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+(\d+)\s*$/;
for (const r of resolutions) {
  for (const file of [`showcase-${r}.txt`, `showcase100k-${r}.txt`].filter(ran)) {
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
      const engine = engineIds[withoutRevision( m[3].trim() )];
      if (!engine) { failures.push(`${file}: unknown renderer "${m[3].trim()}"`); continue; }
      ((showcase[r] ??= {})[m[2]] ??= {})[m[1]] ??= {};
      showcase[r][m[2]][m[1]][engine] = { fps: num(m[4]), frame: num(m[5]), update: num(m[6]), submit: num(m[7]), calls: num(m[8]), build: num(m[9]) };
    }
  }
  for (const [mode, counts] of [['objects', [2000, 10000, 50000]], ['instanced', [2000, 10000, 50000, 100000]]]) {
    for (const count of counts.filter((c) => c < 100000 || existsSync(join(dir, `showcase100k-${r}.txt`)))) {
      const missing = Object.values(engineIds).filter((e) => !optionalEngines.includes(e) && !showcase[r]?.[mode]?.[count]?.[e]);
      if (missing.length) failures.push(`showcase ${r}, ${count} ${mode}: no result for ${missing.join(', ')}`);
    }
  }
}

// Comparison scene.
const compare = {};
const compareRow = /^\s*(\d+)\s+(\S+)\s+(\d+)\s+([\d.]+) \/ ([\d.]+)\s+(\d+)\s+([\d.]+) \/ ([\d.]+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(.+?)\s*$/;
for (const r of resolutions.filter((r) => ran(`compare-${r}.txt`))) {
  const text = read(`compare-${r}.txt`);
  const gpu = text.match(/^GPU: (.+)$/m);
  if (gpu) meta.gpu = gpu[1];
  compare[r] = text.split('\n').map((line) => line.match(compareRow)).filter(Boolean).map((m) => ({
    objects: num(m[1]), engine: m[2], frames: num(m[3]), frame: num(m[4]), frameP95: num(m[5]), fps: num(m[6]),
    update: num(m[7]), updateP95: num(m[8]), submit: num(m[9]), firstFrame: num(m[10]), wasmInit: m[11] === '-' ? null : num(m[11]), name: withoutRevision( m[12] )
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

// node bench/math.mjs: [workload, three.js ms, low-level Wasm classes ms, wamr3d/math ms].
const mathMix = read('math.txt').split('\n').map((line) => line.match(/^(\S.*?)\s{2,}([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+[\d.]+x\s+[\d.]+x\s*$/)).filter(Boolean).map((m) => [m[1].trim(), num(m[2]), num(m[3]), num(m[4])]);

const allEngines = [
  { id: 'batched', label: 'WAMR3D · batched API', short: 'WAMR3D batched', series: 1 },
  { id: 'object', label: 'WAMR3D · object API', short: 'WAMR3D object API', series: 2 },
  { id: 'mix', label: 'WAMR3D · JS math + WebGPU', short: 'WAMR3D JS math', series: 7 },
  { id: 'batched-webgl', label: 'WAMR3D · batched API · WebGL 2', short: 'WAMR3D batched WebGL', series: 5 },
  { id: 'object-webgl', label: 'WAMR3D · object API · WebGL 2', short: 'WAMR3D object API WebGL', series: 6 },
  { id: 'mix-webgl', label: 'WAMR3D · JS math + WebGL 2', short: 'WAMR3D JS math WebGL', series: 8 },
  { id: 'webgpu', label: 'three.js · WebGPU', short: 'three.js WebGPU', series: 3 },
  { id: 'webgl', label: 'three.js · WebGL', short: 'three.js WebGL', series: 4 }
];
const measured = (id) => Object.values(showcase).some((modes) => Object.values(modes).some((counts) => Object.values(counts).some((row) => row[id])));
const engines = allEngines.filter(({ id }) => !optionalEngines.includes(id) || measured(id));

const json = (v) => JSON.stringify(v);
writeFileSync(join(root, 'website/src/data/benchmarks.js'), `// Generated by website/scripts/benchmark-data.mjs from ${meta.dir}/. Do not edit by hand.

export const meta = ${JSON.stringify(meta, null, 2)};

export const resolutions = ${json(resolutions)};

export const engines = ${JSON.stringify(engines, null, 2)};

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

// node bench/math.mjs: [workload, three.js ms, low-level Wasm math classes ms, wamr3d/math ms].
export const mathMix = ${json(mathMix)};

export const failures = ${json(failures)};
`);
console.log(`wrote website/src/data/benchmarks.js from ${meta.dir}: ${lowLevel.length} + ${objectApi.length} + ${mathMix.length} Node.js rows, ${failures.length} failures`);
for (const f of failures) console.log(`  ${f}`);
