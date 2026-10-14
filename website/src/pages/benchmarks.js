import { button, codeBlock, pageIntro, repoFile, sectionHead, shell } from '../components/ui.js';
import { showcaseChart } from '../components/charts.js';
import { compare, failures, lowLevel, meta, objectApi, resolutions, startup } from '../data/benchmarks.js';
import { findings } from '../data/findings.js';

const th = 'py-3 pr-4 font-medium';
const td = 'py-2.5 pr-4';
const num = (v, d = 1) => `<td class="${td} text-right font-mono tabular-nums text-slate-200">${v === null || v === undefined ? '–' : v.toFixed(d)}</td>`;
const resLabel = (r) => r.replace('x', '×');

function ratioCell(ratio) {
  const faster = ratio < 1;
  return `<td class="${td} text-right font-mono tabular-nums ${faster ? 'text-emerald-300' : 'text-slate-300'}">${ratio.toFixed(2)}×<span class="sr-only"> ${faster ? 'WAMR3D faster' : 'WAMR3D slower'}</span></td>`;
}

function ratioTable(rows, caption) {
  return `<div class="glass relative overflow-x-auto rounded-3xl p-2 sm:p-4"><table class="w-full min-w-[36rem] text-left text-sm">
    <caption class="sr-only">${caption}</caption>
    <thead class="font-mono text-[11px] uppercase tracking-wider text-slate-400"><tr><th class="${th} pl-3">Workload</th><th class="${th} text-right">three.js ms</th><th class="${th} text-right">WAMR3D ms</th><th class="${th} text-right">WAMR3D / three.js</th></tr></thead>
    <tbody>${rows.map(([name, three, wamr, ratio]) => `<tr class="border-t border-white/5"><td class="${td} pl-3 text-slate-300">${name}</td>${num(three, 3)}${num(wamr, 3)}${ratioCell(ratio)}</tr>`).join('')}</tbody>
  </table></div>`;
}

// One row per engine and object count, one column group per resolution.
function compareTable() {
  const keys = [...new Map(resolutions.flatMap((r) => (compare[r] ?? []).map((x) => [`${x.objects}|${x.engine}`, x]))).values()].filter((x) => x.objects > 100);
  const cell = (r, k) => {
    const x = (compare[r] ?? []).find((y) => y.objects === k.objects && y.engine === k.engine);
    return x ? `<td class="${td} text-right font-mono tabular-nums text-slate-200">${x.fps}</td><td class="${td} text-right font-mono tabular-nums text-slate-300">${x.update.toFixed(1)}</td><td class="${td} border-r border-white/5 text-right font-mono tabular-nums text-slate-300">${x.submit.toFixed(1)}</td>` : `<td colspan="3" class="${td} border-r border-white/5 text-center text-slate-400">not measured</td>`;
  };
  return `<div class="glass relative overflow-x-auto rounded-3xl p-2 sm:p-4"><table class="w-full min-w-[64rem] text-left text-sm">
    <caption class="sr-only">Comparison scene: fps, CPU update ms and draw submission ms per resolution</caption>
    <thead class="font-mono text-[11px] uppercase tracking-wider text-slate-400">
      <tr><th class="${th} pl-3" rowspan="2">Objects</th><th class="${th}" rowspan="2">Engine</th>${resolutions.map((r) => `<th class="${th} border-r border-white/5 text-center" colspan="3">${resLabel(r)}</th>`).join('')}</tr>
      <tr>${resolutions.map(() => `<th class="${th} text-right">fps</th><th class="${th} text-right">upd</th><th class="${th} border-r border-white/5 text-right">sub</th>`).join('')}</tr>
    </thead>
    <tbody>${keys.map((k) => `<tr class="border-t border-white/5 ${k.name.startsWith('WAMR3D') ? 'bg-white/[0.02]' : ''}"><td class="${td} pl-3 font-mono text-slate-400">${k.objects.toLocaleString('en-US')}</td><td class="${td} text-slate-300">${k.name}</td>${resolutions.map((r) => cell(r, k)).join('')}</tr>`).join('')}</tbody>
  </table></div>`;
}

export function benchmarks() {
  const canvasNote = resolutions.map((r) => `${resLabel(r)} → ${(meta.canvases[r] ?? ['not recorded']).map(resLabel).join(', ')}`).join('; ');
  return shell(`${pageIntro({ label: 'Benchmarks', title: 'Measured, <span class="text-gradient">with context.</span>', intro: `The browser runs were measured on one machine, one run per configuration, on ${meta.date}, at four canvas resolutions. The Node.js microbenchmarks have no GPU and no canvas resolution. Results are generated from the raw logs; ratios are computed from medians. Nothing is estimated. This snapshot predates the renderer-feature milestone documented in STATUS.md; it reports the showcase workloads and does not measure the performance of the newly added effects.` })}
  <div class="relative bg-gradient-to-b from-transparent via-ink-950/85 to-ink-950">
    <section class="mx-auto max-w-6xl px-6 pb-24">
      <div class="glass mb-10 grid gap-5 rounded-3xl p-6 text-sm sm:grid-cols-2 lg:grid-cols-3" data-reveal>
        <div><p class="font-mono text-[11px] uppercase tracking-wider text-slate-400">Hardware</p><p class="mt-1 text-slate-200">${meta.cpu}; ${meta.gpu}</p></div>
        <div><p class="font-mono text-[11px] uppercase tracking-wider text-slate-400">Browser and OS</p><p class="mt-1 text-slate-200">${meta.chrome}, headless (<code class="font-mono">--headless=new</code>, GPU enabled, ANGLE on Direct3D 11), ${meta.os}; Node.js ${meta.node}</p></div>
        <div><p class="font-mono text-[11px] uppercase tracking-wider text-slate-400">Rendering backends</p><p class="mt-1 text-slate-200">WAMR3D and three.js WebGPURenderer on WebGPU; three.js WebGLRenderer on WebGL 2. Pixel ratio 1.</p></div>
        <div><p class="font-mono text-[11px] uppercase tracking-wider text-slate-400">Resolution requested → canvas drawn</p><p class="mt-1 text-slate-200">${canvasNote}</p></div>
        <div><p class="font-mono text-[11px] uppercase tracking-wider text-slate-400">What is timed</p><p class="mt-1 text-slate-200">CPU time in JavaScript, 0.1 ms resolution. GPU time is not measured; it shows only in the frame rate, which the display loop caps at 60.</p></div>
        <div><p class="font-mono text-[11px] uppercase tracking-wider text-slate-400">Failed configurations</p><p class="mt-1 text-slate-200">${failures.length ? failures.join('; ') : 'None: every configuration produced results.'}</p></div>
      </div>
      ${sectionHead({ label: 'Showcase · examples/showcase/check.mjs --measure --size=W×H', title: 'A large animated scene', intro: 'Medians over 4 s after a 1.5 s warm-up, one engine at a time. <em>Update</em> is animation, transforms and world matrices; <em>submit</em> is the renderer’s work on the CPU. Separate meshes use one draw call per body; instanced meshes use five (six for three.js WebGPU).' })}
      <div data-reveal>${showcaseChart('objects', 10000)}</div>
      <ul class="mt-8 grid gap-4 text-sm leading-relaxed text-slate-400 md:grid-cols-3" data-reveal>${findings.showcase.map(([title, body]) => `<li class="glass rounded-2xl p-5"><strong class="text-slate-200">${title}</strong> ${body}</li>`).join('')}</ul>
    </section>

    <section class="mx-auto max-w-6xl px-6 py-24">
      ${sectionHead({ label: 'Comparison scene · examples/compare/measure.mjs --gpu --size=W×H', title: 'Same scene code, different engines', intro: '3 s warm-up, 8 s sample, medians, one engine per page load. For each resolution: fps, CPU update ms (upd) and draw submission ms (sub). The three.js WebGL, three.js WebGPU and WAMR3D object API rows run the same scene code. The last two rows of each group draw with the three.js WebGL renderer, so only the transforms differ.' })}
      <div data-reveal>${compareTable()}</div>
      <ul class="mt-8 list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-400 marker:text-brand-cyan" data-reveal>${findings.compare.map((t) => `<li>${t}</li>`).join('')}</ul>
    </section>

    <section class="mx-auto max-w-6xl px-6 py-24">
      ${sectionHead({ label: 'Low-level API · bench/bench.mjs', title: 'Where the boundary costs, and where it pays', intro: `Node.js, no GPU, so resolution does not apply. 5 warm-up runs, 25 samples per workload. Below 1× means WAMR3D was faster.${startup ? ` Start-up: WAMR3D init (compile and instantiate ${startup.wasmKiB} KiB of Wasm) took ${startup.wamrInit} ms.` : ''}` })}
      <div data-reveal>${ratioTable(lowLevel, 'Low-level API benchmark')}</div>
      <p class="mt-4 text-sm text-slate-400" data-reveal>The create + parent + destroy row is not an equal comparison: three.js leaves freeing to the garbage collector, outside the timed region. Read it as “object churn is cheap here”, not as a speed-up.</p>
    </section>

    <section class="mx-auto max-w-6xl px-6 py-24">
      ${sectionHead({ label: 'Object API · bench/compat.mjs', title: 'The three.js-style classes', intro: 'The same application code run against <code class="font-mono">wamr3d/compat</code> and three.js in Node.js, median of 21. Use the math classes for convenience, not for speed.' })}
      <div data-reveal>${ratioTable(objectApi, 'Object API benchmark')}</div>
    </section>

    <section class="mx-auto max-w-6xl px-6 py-24">
      ${sectionHead({ label: 'Reproduce', title: 'Run them on your machine' })}
      <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div data-reveal>${codeBlock(`node engine/bindings/build.mjs
node examples/browser/serve.mjs          # in another terminal

node examples/showcase/check.mjs --measure --size=1920x1080
node examples/showcase/check.mjs --measure --counts=100000 --modes=instanced --size=1920x1080
node examples/compare/measure.mjs --gpu --size=1920x1080
node bench/bench.mjs                     # needs npm install (three@0.186.1)
node bench/compat.mjs`, { title: 'terminal', language: 'sh' })}</div>
        <div class="space-y-4 text-slate-400" data-reveal>
          <p>Or open the <a class="text-brand-cyan hover:text-white" href="./examples/showcase/">live showcase</a> and press “Compare all four renderers” to measure your own browser, display and GPU.</p>
          <p>Close other headless browsers before measuring: leftover processes once made every engine 20–50% slower. The raw logs of this run are in <a class="text-brand-cyan hover:text-white" href="${repoFile('bench/results/2026-10-14')}" target="_blank" rel="noreferrer">bench/results/2026-10-14</a>.</p>
          <div class="flex flex-wrap gap-3">${button('./examples/showcase/', 'Open the showcase')}${button(repoFile('bench/results/2026-10-14'), 'Raw logs of this run', 'secondary', true)}</div>
        </div>
      </div>
    </section>
  </div>`, 'benchmarks');
}
