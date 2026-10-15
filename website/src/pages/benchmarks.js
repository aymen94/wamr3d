import { button, codeBlock, pageIntro, repoFile, sectionHead, shell } from '../components/ui.js';
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
  return shell(`${pageIntro({ label: 'Benchmarks', title: 'Measured, <span class="text-gradient">with context.</span>', intro: `Measured on one machine on ${meta.date}, one run per configuration, at four canvas resolutions. Every figure on this page comes from the raw logs; ratios are computed from medians and nothing is estimated. This run includes WAMR3D on its WebGL 2 renderer. The comparison scene was not run at 3840×2160 (time limit); the showcase covers all four resolutions.` })}
  <div class="relative bg-gradient-to-b from-transparent via-ink-950/85 to-ink-950">
    <section class="mx-auto max-w-6xl px-6 pb-24">
      <div class="glass mb-6 flex flex-col gap-4 rounded-3xl p-6 text-sm sm:flex-row sm:items-center" data-reveal>
        <p class="font-semibold text-white sm:w-48 sm:shrink-0">How to read the charts</p>
        <p class="text-slate-300">In the main charts a <strong class="text-white">longer bar is always better</strong>: frames per second, and how many times faster WAMR3D is than three.js. CPU milliseconds, where less is better, appear only in their own chart or table, and those carry a ${better('lower')} badge.</p>
      </div>
      <div class="glass mb-10 grid gap-5 rounded-3xl p-6 text-sm sm:grid-cols-2 lg:grid-cols-3" data-reveal>
        <div><p class="font-mono text-[11px] uppercase tracking-wider text-slate-400">Hardware</p><p class="mt-1 text-slate-200">${meta.cpu}; ${meta.gpu}</p></div>
        <div><p class="font-mono text-[11px] uppercase tracking-wider text-slate-400">Browser and OS</p><p class="mt-1 text-slate-200">${meta.chrome}, headless (<code class="font-mono">--headless=new</code>, GPU enabled, ANGLE on Direct3D 11), ${meta.os}; Node.js ${meta.node}</p></div>
        <div><p class="font-mono text-[11px] uppercase tracking-wider text-slate-400">Rendering backends</p><p class="mt-1 text-slate-200">WAMR3D on WebGPU and on its own WebGL 2 renderer; three.js WebGPURenderer on WebGPU and WebGLRenderer on WebGL 2. Pixel ratio 1.</p></div>
        <div><p class="font-mono text-[11px] uppercase tracking-wider text-slate-400">Resolution requested → canvas drawn</p><p class="mt-1 text-slate-200">${canvasNote}</p></div>
        <div><p class="font-mono text-[11px] uppercase tracking-wider text-slate-400">What is timed</p><p class="mt-1 text-slate-200">CPU time in JavaScript, 0.1 ms resolution. GPU time is not measured; it shows only in the frame rate, which the display caps at 60.</p></div>
        <div><p class="font-mono text-[11px] uppercase tracking-wider text-slate-400">Failed configurations</p><p class="mt-1 text-slate-200">${failures.length ? failures.join('; ') : 'None: every configuration produced results.'}</p></div>
      </div>
      ${sectionHead({ label: 'Showcase · examples/showcase/check.mjs --measure', title: 'A large animated scene', intro: 'Medians over 4 s after a 1.5 s warm-up, one engine at a time. Separate meshes use one draw call per body; instanced meshes use five (six for three.js WebGPU).' })}
      <div data-reveal>${showcaseChart('objects', 10000)}</div>
      <ul class="mt-8 grid gap-4 text-sm leading-relaxed text-slate-400 md:grid-cols-3" data-reveal>${findings.showcase.map(([title, body]) => `<li class="glass rounded-2xl p-5"><strong class="text-slate-200">${title}</strong> ${body}</li>`).join('')}</ul>
    </section>

    <section class="mx-auto max-w-6xl px-6 py-24">
      ${sectionHead({ label: 'Comparison scene · examples/compare/measure.mjs --gpu', title: 'Same scene code, different engines', intro: '3 s warm-up, 8 s sample, medians, one engine per page load. The WAMR3D object API and both three.js renderers run the same scene code. The last two rows of each group both draw with the three.js WebGL renderer, so only their transforms differ.' })}
      <div data-reveal>${compareTable()}</div>
      <ul class="mt-8 list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-400 marker:text-brand-cyan" data-reveal>${findings.compare.map((t) => `<li>${t}</li>`).join('')}</ul>
    </section>

    <section class="mx-auto max-w-6xl px-6 py-24">
      ${sectionHead({ label: 'Low-level API · bench/bench.mjs', title: 'Where the boundary costs, and where it pays', intro: `Node.js, no GPU. 5 warm-up runs, 25 samples per workload. Bars to the right of the centre line mean WAMR3D was faster, bars to the left mean slower.${startup ? ` Start-up: compiling and instantiating ${startup.wasmKiB} KiB of WebAssembly took ${startup.wamrInit} ms.` : ''}` })}
      <div data-reveal>${speedTable(lowLevel, 'Low-level API benchmark: WAMR3D speed against three.js')}</div>
      <p class="mt-4 text-sm text-slate-400" data-reveal>The create + parent + destroy row is not an equal comparison: three.js leaves freeing to the garbage collector, outside the timed region. Read it as “object churn is cheap here”, not as a speed-up.</p>
    </section>

    <section class="mx-auto max-w-6xl px-6 py-24">
      ${sectionHead({ label: 'Object API · bench/compat.mjs', title: 'The three.js-style classes', intro: 'The same application code run against <code class="font-mono">wamr3d/compat</code> and three.js in Node.js, median of 21. Scene work is faster; single math calls are slower, so use the math classes for convenience rather than speed.' })}
      <div data-reveal>${speedTable(objectApi, 'Object API benchmark: WAMR3D speed against three.js')}</div>
    </section>

    <section class="mx-auto max-w-6xl px-6 py-24">
      ${sectionHead({ label: 'Reproduce', title: 'Run them on your machine' })}
      <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div data-reveal>${codeBlock(`node engine/bindings/build.mjs
node examples/browser/serve.mjs          # in another terminal

node examples/showcase/check.mjs --measure --size=1920x1080
node examples/showcase/check.mjs --measure --counts=100000 --modes=instanced --size=1920x1080
node examples/compare/measure.mjs --gpu --size=1920x1080
node bench/bench.mjs                     # needs npm install (the pinned three)
node bench/compat.mjs

# logs saved per size in bench/results/<date>/, then:
node website/scripts/benchmark-data.mjs bench/results/<date>`, { title: 'terminal', language: 'sh' })}</div>
        <div class="space-y-4 text-slate-400" data-reveal>
          <p>Or open the <a class="text-brand-cyan hover:text-white" href="./examples/showcase/" target="_blank" rel="noreferrer">live showcase</a> and press “Compare all six renderers” to measure your own browser, display and GPU.</p>
          <p>Close other headless browsers before measuring: leftover processes once made every engine 20–50% slower. The raw logs of this run are in <a class="text-brand-cyan hover:text-white" href="${logs}" target="_blank" rel="noreferrer">${meta.dir}</a>.</p>
          <div class="flex flex-wrap gap-3">${button('./examples/showcase/', 'Open the showcase', 'primary', true)}${button(logs, 'Raw logs of this run', 'secondary', true)}</div>
        </div>
      </div>
    </section>
  </div>`, 'benchmarks');
}
