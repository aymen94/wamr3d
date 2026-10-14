import { engines, resolutions, showcase } from '../data/benchmarks.js';

export const metrics = [
  { key: 'fps', title: 'Frames per second', unit: 'fps', better: 'higher is better · display limit 60', max: () => 60, digits: 1 },
  { key: 'update', title: 'Scene update on the CPU', unit: 'ms', better: 'lower is better', digits: 1 },
  { key: 'submit', title: 'Draw submission on the CPU', unit: 'ms', better: 'lower is better', digits: 1 }
];

export const counts = { objects: [2000, 10000, 50000], instanced: [2000, 10000, 50000, 100000] };
export const defaultResolution = resolutions[0];
const fmt = (n) => n.toLocaleString('en-US');
const resLabel = (r) => r.replace('x', '×');

const row = (resolution, mode, count, engine) => showcase[resolution]?.[mode]?.[count]?.[engine] ?? null;

export function chartValues(resolution, mode, count) {
  return metrics.map((metric) => {
    const values = engines.map((engine) => row(resolution, mode, count, engine.id)?.[metric.key] ?? null);
    const max = metric.max ? metric.max() : Math.max(...values.filter((v) => v !== null), 0.001);
    return { metric, values, max };
  });
}

export const barWidth = (value, max) => value === null ? '0px' : `calc(${Math.max(value / max, 0.004).toFixed(4)} * (100% - 4.5rem))`;
export const barText = (value, metric) => value === null ? 'not measured' : value.toFixed(metric.digits);

function bar(engine, metric, value, max) {
  const tip = `${engine.label}: ${value === null ? 'not measured' : `${value.toFixed(metric.digits)} ${metric.unit}`}`;
  return `<div class="grid grid-cols-[7.5rem_1fr] items-center gap-3 sm:grid-cols-[9rem_1fr]">
    <span class="truncate text-xs text-slate-300">${engine.short}</span>
    <div class="flex h-6 items-center gap-2" data-bar-row>
      <div data-bar="${engine.id}-${metric.key}" data-tip="${tip}" tabindex="0" role="img" aria-label="${tip}"
        class="h-full rounded-r-[4px] outline-offset-2 transition-[width] duration-700 ease-out hover:brightness-125" style="width: ${barWidth(value, max)}; background: var(--color-series-${engine.series})"></div>
      <span data-value="${engine.id}-${metric.key}" class="font-mono text-xs tabular-nums text-slate-200">${barText(value, metric)}</span>
    </div>
  </div>`;
}

export function legend() {
  return `<ul class="flex flex-wrap gap-x-5 gap-y-2" aria-label="Legend">${engines.map((engine) => `<li class="flex items-center gap-2 text-xs text-slate-300"><span class="size-2.5 rounded-sm" style="background: var(--color-series-${engine.series})"></span>${engine.label}</li>`).join('')}</ul>`;
}

export function chartTableBody(resolution, mode, count) {
  const cell = (v, d = 1) => `<td class="py-2 pr-3 text-right font-mono tabular-nums text-slate-200">${v === null || v === undefined ? '–' : typeof v === 'number' ? v.toFixed(d) : v}</td>`;
  return engines.map((engine) => {
    const r = row(resolution, mode, count, engine.id);
    return `<tr class="border-t border-white/5"><td class="py-2 pr-3 text-slate-300">${engine.label}</td>${r ? cell(r.fps) + cell(r.frame) + cell(r.update) + cell(r.submit) + cell(r.calls, 0) : `<td colspan="5" class="py-2 text-right text-slate-400">not measured</td>`}</tr>`;
  }).join('');
}

function table(resolution, mode, count) {
  return `<table class="w-full text-left text-sm"><caption class="sr-only">Showcase measurements for the selected resolution, mode and body count</caption>
    <thead class="font-mono text-[11px] uppercase tracking-wider text-slate-400"><tr><th class="py-2 pr-3 font-medium">Engine</th><th class="py-2 pr-3 text-right font-medium">fps</th><th class="py-2 pr-3 text-right font-medium">frame ms</th><th class="py-2 pr-3 text-right font-medium">update ms</th><th class="py-2 pr-3 text-right font-medium">submit ms</th><th class="py-2 pr-3 text-right font-medium">draw calls</th></tr></thead>
    <tbody data-chart-table>${chartTableBody(resolution, mode, count)}</tbody></table>`;
}

// Frame rate of every engine at every resolution, for the selected mode and body count.
export function scalingRows(mode, count) {
  return resolutions.map((resolution) => `<div class="grid grid-cols-[5.5rem_1fr] items-center gap-3" data-scaling="${resolution}">
    <span class="font-mono text-xs text-slate-300">${resLabel(resolution)}</span>
    <div class="space-y-1">${engines.map((engine) => {
      const fps = row(resolution, mode, count, engine.id)?.fps ?? null;
      const tip = `${engine.label} at ${resLabel(resolution)}: ${fps === null ? 'not measured' : `${fps.toFixed(1)} fps`}`;
      return `<div class="flex h-2.5 items-center gap-2" data-bar-row><div data-bar="scale-${resolution}-${engine.id}" data-tip="${tip}" tabindex="0" role="img" aria-label="${tip}" class="h-full rounded-r-[3px] hover:brightness-125" style="width: ${barWidth(fps, 60)}; background: var(--color-series-${engine.series})"></div><span class="font-mono text-[10px] leading-none tabular-nums text-slate-300">${fps === null ? '–' : fps.toFixed(1)}</span></div>`;
    }).join('')}</div>
  </div>`).join('');
}

function segmented(name, options, active, label, disabled = []) {
  return `<div role="radiogroup" aria-label="${label}" class="inline-flex flex-wrap rounded-full bg-white/5 p-1 ring-1 ring-white/10">${options.map(([value, text]) => `<button type="button" role="radio" aria-checked="${String(value) === String(active)}" data-chart-${name}="${value}"${disabled.includes(value) ? ' disabled' : ''} class="rounded-full px-3.5 py-1.5 text-xs font-medium transition aria-checked:bg-white aria-checked:text-ink-950 text-slate-300 hover:text-white disabled:cursor-not-allowed disabled:opacity-30">${text}</button>`).join('')}</div>`;
}

export function showcaseChart(mode = 'objects', count = 10000, resolution = defaultResolution) {
  const panels = chartValues(resolution, mode, count);
  return `<div class="glass rounded-3xl p-5 sm:p-8" data-chart data-mode="${mode}" data-count="${count}" data-resolution="${resolution}">
    <div class="mb-6 flex flex-col gap-4">
      <div>
        <h3 class="font-display text-xl font-semibold text-white">The showcase scene, four renderers</h3>
        <p class="mt-1 text-sm text-slate-400">Sun, belts, clusters and bodies: a four-level scene graph where every rotation changes each frame.</p>
      </div>
      <div class="flex flex-wrap gap-2">
        ${segmented('resolution', resolutions.map((r) => [r, resLabel(r)]), resolution, 'Canvas resolution')}
        ${segmented('mode', [['objects', 'Separate meshes'], ['instanced', 'Instanced']], mode, 'Draw mode')}
        ${segmented('count', counts.instanced.map((c) => [c, fmt(c)]), count, 'Number of bodies', mode === 'objects' ? [100000] : [])}
      </div>
    </div>
    <div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
      ${panels.map(({ metric, values, max }) => `<figure class="rounded-2xl bg-ink-950/50 p-4 ring-1 ring-white/5" data-panel="${metric.key}">
        <figcaption class="mb-4"><span class="block text-sm font-semibold text-white">${metric.title}</span><span class="font-mono text-[11px] text-slate-400">${metric.unit} · ${metric.better}</span></figcaption>
        <div class="space-y-2.5">${engines.map((engine, i) => bar(engine, metric, values[i], max)).join('')}</div>
      </figure>`).join('')}
    </div>
    <figure class="mt-6 rounded-2xl bg-ink-950/50 p-4 ring-1 ring-white/5">
      <figcaption class="mb-4"><span class="block text-sm font-semibold text-white">Frame rate by canvas resolution</span><span class="font-mono text-[11px] text-slate-400">fps · same mode and body count · higher is better · display limit 60</span></figcaption>
      <div class="grid grid-cols-1 gap-4 md:grid-cols-2" data-scaling-rows>${scalingRows(mode, count)}</div>
    </figure>
    <div class="mt-6 flex flex-col gap-4 border-t border-white/5 pt-5 sm:flex-row sm:items-start sm:justify-between">
      ${legend()}
      <details class="group min-w-0 text-sm sm:max-w-lg sm:text-right">
        <summary class="cursor-pointer list-none font-medium text-brand-cyan hover:text-white">Show as table</summary>
        <div class="relative mt-3 overflow-x-auto text-left">${table(resolution, mode, count)}</div>
      </details>
    </div>
  </div>`;
}
