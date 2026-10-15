import { button, codeBlock, more, pageIntro, repoFile, sectionHead, shell } from '../components/ui.js';
import { better, showcaseChart, speedTable } from '../components/charts.js';
import { compare, failures, lowLevel, meta, objectApi, resolutions, startup } from '../data/benchmarks.js';
import { findings } from '../data/findings.js';

const th = 'py-3 pr-4 font-medium';
const td = 'py-2.5 pr-4';
const resLabel = (r) => r.replace('x', '×');

// Rows that run on their own renderer, in a fixed order; the adapter pair is the transform-only baseline.
const compareOrder = ['api', 'native', 'api-webgl', 'native-webgl', 'three-webgpu', 'three-webgl', 'wamr3d', 'three'];
const compareNames = { wamr3d: 'WAMR3D transforms, three.js WebGL renderer', three: 'three.js transforms, three.js WebGL renderer' };
const compareName = (k) => compareNames[k.engine] ?? k.name;

function compareRows() {
  const keys = [...new Map(resolutions.flatMap((r) => (compare[r] ?? []).map((x) => [`${x.objects}|${x.engine}`, x]))).values()]
    .filter((x) => x.objects > 100)
    .sort((a, b) => a.objects - b.objects || compareOrder.indexOf(a.engine) - compareOrder.indexOf(b.engine));
  const find = (r, k) => (compare[r] ?? []).find((y) => y.objects === k.objects && y.engine === k.engine);
  return { keys, find };
}

function compareTable() {
  const { keys, find } = compareRows();
  const max = 60;
  const fpsCell = (r, k) => {
    const x = find(r, k);
    if (!x) return `<td class="${td} text-center text-slate-400">–</td>`;
    return `<td class="${td}"><div class="flex items-center gap-2"><div class="h-2 rounded-r-[3px] ${k.name.startsWith('WAMR3D') ? 'bg-[var(--color-series-1)]' : 'bg-slate-400/70'}" style="width: ${Math.max(x.fps / max, 0.02) * 3.5}rem"></div><span class="font-mono tabular-nums text-slate-200">${x.fps}</span></div></td>`;
  };
  const cpuCell = (r, k) => {
    const x = find(r, k);
    return x ? `<td class="${td} text-right font-mono tabular-nums text-slate-300">${(x.update + x.submit).toFixed(1)}</td>` : `<td class="${td} text-center text-slate-400">–</td>`;
  };
  const head = (unit) => `<thead class="font-mono text-[11px] uppercase tracking-wider text-slate-400"><tr><th class="${th} pl-3">Objects</th><th class="${th}">Engine</th>${resolutions.map((r) => `<th class="${th}">${resLabel(r)} ${unit}</th>`).join('')}</tr></thead>`;
  const rowsHtml = (cell) => keys.map((k) => `<tr class="border-t border-white/5 ${k.name.startsWith('WAMR3D') ? 'bg-white/[0.02]' : ''}"><td class="${td} pl-3 font-mono text-slate-400">${k.objects.toLocaleString('en-US')}</td><td class="${td} text-slate-300">${compareName(k)}</td>${resolutions.map((r) => cell(r, k)).join('')}</tr>`).join('');
  return `<div class="glass relative overflow-x-auto rounded-3xl p-2 sm:p-4">
    <div class="flex items-center justify-between gap-3 px-3 pt-2"><p class="text-sm font-semibold text-white">Frames per second</p>${better('higher')}</div>
    <table class="mt-2 w-full min-w-[52rem] text-left text-sm"><caption class="sr-only">Comparison scene: frames per second per resolution</caption>${head('fps')}<tbody>${rowsHtml(fpsCell)}</tbody></table>
  </div>
  <details class="glass mt-4 rounded-3xl p-2 sm:p-4">
    <summary class="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-3 py-2"><span class="text-sm font-semibold text-brand-cyan hover:text-white">CPU time per frame (update + draw submission)</span>${better('lower')}</summary>
    <div class="overflow-x-auto"><table class="mt-2 w-full min-w-[52rem] text-left text-sm"><caption class="sr-only">Comparison scene: CPU milliseconds per frame per resolution</caption>${head('ms')}<tbody>${rowsHtml(cpuCell)}</tbody></table></div>
  </details>`;
}

export function benchmarks() {
  const logs = repoFile(meta.dir);
  const canvasNote = resolutions.map((r) => `${resLabel(r)} → ${(meta.canvases[r] ?? ['not recorded']).map(resLabel).join(', ')}`).join('; ');
  const matrixReadback = lowLevel.find(([name]) => name === 'scene: read back 10,000 world matrices into one Float32Array');
  const webgpuAt10k = compare['1280x720'] ?? [];
  const wamrSubmission = webgpuAt10k.find((row) => row.engine === 'native' && row.objects >= 10000);
  const threeSubmission = webgpuAt10k.find((row) => row.engine === 'three-webgpu' && row.objects >= 10000);
  const matrixNote = matrixReadback ? `Reading 10,000 world matrices into one Float32Array took ${matrixReadback[2]} ms in WAMR3D against ${matrixReadback[1]} ms in three.js (${(matrixReadback[1] / matrixReadback[2]).toFixed(1)}× faster).` : 'Reading world matrices into one Float32Array is measured below.';
  const submissionNote = wamrSubmission && threeSubmission ? `At about 10,000 objects and 1280×720, WAMR3D WebGPU submitted a frame ${(threeSubmission.submit / wamrSubmission.submit).toFixed(1)}× faster than three.js WebGPU (${wamrSubmission.submit.toFixed(1)} ms against ${threeSubmission.submit.toFixed(1)} ms).` : 'The table compares frame timing at each available resolution.';
  const setup = [
    ['Hardware', `${meta.cpu}; ${meta.gpu}`],
    ['Browser and OS', `${meta.chrome}, headless (<code class="font-mono">--headless=new</code>, GPU enabled, ANGLE on Direct3D 11), ${meta.os}; Node.js ${meta.node}`],
    ['Rendering backends', 'WAMR3D on WebGPU and on its own WebGL 2 renderer; three.js WebGPURenderer on WebGPU and WebGLRenderer on WebGL 2. Pixel ratio 1.'],
    ['Resolution requested → canvas drawn', canvasNote],
    ['What is timed', 'CPU time in JavaScript, 0.1 ms resolution. GPU time is not measured; it shows only in the frame rate, which the display caps at 60.'],
    ['Method', `One run per configuration, medians, nothing estimated. The comparison scene was not run at 3840×2160 (time limit).`],
    ['Failed configurations', failures.length ? failures.join('; ') : 'None: every configuration produced results.']
  ];
  return shell(`${pageIntro({ label: 'Benchmarks', title: 'Measured, <span class="text-gradient">with context.</span>', intro: `One machine, fresh 1280×720 measurements and the earlier same-day results at three higher resolutions. Every number comes from the raw logs. <strong class="text-white">Longer bars are better.</strong>` })}
  <div class="relative bg-gradient-to-b from-transparent via-ink-950/85 to-ink-950">
    <section class="mx-auto max-w-6xl px-6 pb-24">
      ${more('Test setup', `<div class="glass grid gap-5 rounded-3xl p-6 sm:grid-cols-2 lg:grid-cols-3">${setup.map(([k, v]) => `<div><p class="font-mono text-[11px] uppercase tracking-wider text-slate-400">${k}</p><p class="mt-1 text-slate-200">${v}</p></div>`).join('')}</div>`, '-mt-8 mb-14')}
      ${sectionHead({ label: 'Showcase', title: 'A large animated scene', intro: 'Thousands of moving bodies, one engine at a time.' })}
      <div data-reveal>${showcaseChart('objects', 10000)}</div>
      ${more('What the numbers say', `<ul class="grid gap-4 md:grid-cols-3">${findings.showcase.map(([title, body]) => `<li class="glass rounded-2xl p-5"><strong class="text-slate-200">${title}</strong> ${body}</li>`).join('')}</ul><p class="mt-4">Medians over 4 s after a 1.5 s warm-up. Separate meshes use one draw call per body; instanced meshes use five (six for three.js WebGPU). Script: <code class="font-mono">examples/showcase/check.mjs --measure</code>.</p>`)}
    </section>

    <section class="mx-auto max-w-6xl px-6 py-24">
      ${sectionHead({ label: 'Comparison scene', title: 'Same code, different engines', intro: `${submissionNote} One scene, written once, run on each engine.` })}
      <div data-reveal>${compareTable()}</div>
      ${more('What the numbers say', `<ul class="list-disc space-y-2 pl-5 marker:text-brand-cyan">${findings.compare.map((t) => `<li>${t}</li>`).join('')}</ul><p class="mt-4">3 s warm-up, 8 s sample, one engine per page load. The last two rows of each group both draw with the three.js WebGL renderer, so only their transforms differ. Script: <code class="font-mono">examples/compare/measure.mjs --gpu</code>.</p>`)}
    </section>

    <section class="mx-auto max-w-6xl px-6 py-24">
      ${sectionHead({ label: 'Low-level API', title: 'Where WebAssembly pays', intro: `${matrixNote} The table also shows where individual calls cost more across the Wasm boundary.` })}
      <div data-reveal>${speedTable(lowLevel, 'Low-level API benchmark: WAMR3D speed against three.js')}</div>
      ${more('Details', `<p>Node.js, no GPU, 5 warm-up runs and 25 samples per workload (<code class="font-mono">bench/bench.mjs</code>).${startup ? ` Compiling and instantiating ${startup.wasmKiB} KiB of WebAssembly took ${startup.wamrInit} ms.` : ''}</p><p class="mt-2">The create + parent + destroy row is not an equal comparison: three.js leaves freeing to the garbage collector, outside the timed region. Read it as “object churn is cheap here”, not as a speed-up.</p>`)}
    </section>

    <section class="mx-auto max-w-6xl px-6 py-24">
      ${sectionHead({ label: 'Object API', title: 'The three.js-style classes', intro: 'Scene work is faster; single math calls are slower.' })}
      <div data-reveal>${speedTable(objectApi, 'Object API benchmark: WAMR3D speed against three.js')}</div>
      ${more('Details', '<p>The same application code run against <code class="font-mono">wamr3d/compat</code> and three.js in Node.js, median of 21 (<code class="font-mono">bench/compat.mjs</code>). Use the math classes for convenience rather than speed: each call crosses into WebAssembly.</p>')}
    </section>

    <section class="mx-auto max-w-6xl px-6 py-24">
      ${sectionHead({ label: 'Reproduce', title: 'Run them on your machine' })}
      <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div data-reveal>${codeBlock(`node engine/bindings/build.mjs
node examples/browser/serve.mjs          # in another terminal

node examples/showcase/check.mjs --measure --size=1280x720
node examples/showcase/check.mjs --measure --counts=100000 --modes=instanced --size=1280x720
node examples/compare/measure.mjs --gpu --size=1280x720
node bench/bench.mjs                     # needs npm install (the pinned three)
node bench/compat.mjs

# logs saved per size in bench/results/<date>/, then:
node website/scripts/benchmark-data.mjs bench/results/<date>`, { title: 'terminal', language: 'sh' })}</div>
        <div class="space-y-4 text-slate-400" data-reveal>
          <p>Or open the <a class="text-brand-cyan hover:text-white" href="./examples/showcase/" target="_blank" rel="noreferrer">live showcase</a> and press “Compare all six renderers”.</p>
          <p>Close other headless browsers first: leftovers can slow every engine by 20–50%.</p>
          <div class="flex flex-wrap gap-3">${button('./examples/showcase/', 'Open the showcase', 'primary', true)}${button(logs, 'Raw logs of this run', 'secondary', true)}</div>
        </div>
      </div>
    </section>
  </div>`, 'benchmarks');
}
