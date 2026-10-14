import { engines, resolutions, showcase } from '../data/benchmarks.js';

// Every main chart reads "longer bar = better" (frames per second, speed against three.js).
// CPU milliseconds are the one exception; they get their own chart with a "lower is better" badge.

export const counts = { objects: [2000, 10000, 50000], instanced: [2000, 10000, 50000, 100000] };
export const defaultResolution = resolutions[0];
const FPS_LIMIT = 60;
const FRAME_BUDGET = 1000 / 60;
const fmt = (n) => n.toLocaleString('en-US');
const resLabel = (r) => r.replace('x', '×');
const row = (resolution, mode, count, engine) => showcase[resolution]?.[mode]?.[count]?.[engine] ?? null;

// Bars leave 4.5rem of the track for their value label.
const track = (fraction) => `calc(${Math.max(fraction, 0.004).toFixed(4)} * (100% - 4.5rem))`;

export function better(direction) {
  const higher = direction === 'higher';
  return `<span class="inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider ring-1 ${higher ? 'bg-emerald-300/10 text-emerald-300 ring-emerald-300/30' : 'bg-white/5 text-slate-300 ring-white/15'}"><span aria-hidden="true">${higher ? '▲' : '▼'}</span>${higher ? 'Higher is better' : 'Lower is better'}</span>`;
}

function panelHead(title, direction, note) {
  return `<figcaption class="mb-4 flex flex-wrap items-start justify-between gap-2"><span><span class="block text-sm font-semibold text-white">${title}</span><span class="font-mono text-[11px] text-slate-400">${note}</span></span>${better(direction)}</figcaption>`;
}

function limitLine(fraction, label) {
  return `<div class="pointer-events-none absolute inset-y-0 border-l border-dashed border-slate-400/60" style="left: ${track(fraction)}" aria-hidden="true"><span class="absolute -top-5 -translate-x-1/2 whitespace-nowrap font-mono text-[10px] text-slate-400">${label}</span></div>`;
}

function fpsPanel(resolution, mode, count) {
  const bars = engines.map((engine) => {
    const fps = row(resolution, mode, count, engine.id)?.fps ?? null;
    const tip = `${engine.label}: ${fps === null ? 'not measured' : `${fps.toFixed(1)} fps`}`;
    return `<div class="grid grid-cols-[7.5rem_1fr] items-center gap-3 sm:grid-cols-[9rem_1fr]">
      <span class="truncate text-xs text-slate-300">${engine.short}</span>
      <div class="flex h-6 items-center gap-2" data-bar-row>
        <div data-bar data-w="${fps === null ? '0px' : track(fps / FPS_LIMIT)}" data-tip="${tip}" tabindex="0" role="img" aria-label="${tip}" class="h-full rounded-r-[4px] outline-offset-2 transition-[width] duration-700 ease-out hover:brightness-125" style="width: ${fps === null ? '0px' : track(fps / FPS_LIMIT)}; background: var(--color-series-${engine.series})"></div>
        <span class="font-mono text-xs tabular-nums text-slate-200">${fps === null ? 'not measured' : fps.toFixed(1)}</span>
      </div>
    </div>`;
  }).join('');
  return `<figure class="rounded-2xl bg-ink-950/50 p-4 ring-1 ring-white/5">
    ${panelHead('Frames per second', 'higher', `fps · ${resLabel(resolution)} · the display caps it at ${FPS_LIMIT}`)}
    <div class="relative space-y-2.5 pt-5"><div class="pointer-events-none absolute inset-y-0 left-[8.25rem] right-0 sm:left-[9.75rem]">${limitLine(1, `${FPS_LIMIT} fps limit`)}</div>${bars}</div>
  </figure>`;
}

function scalingPanel(mode, count) {
  const rows = resolutions.map((resolution) => `<div class="grid grid-cols-[5.5rem_1fr] items-center gap-3">
    <span class="font-mono text-xs text-slate-300">${resLabel(resolution)}</span>
    <div class="space-y-1">${engines.map((engine) => {
      const fps = row(resolution, mode, count, engine.id)?.fps ?? null;
      const tip = `${engine.label} at ${resLabel(resolution)}: ${fps === null ? 'not measured' : `${fps.toFixed(1)} fps`}`;
      const w = fps === null ? '0px' : track(fps / FPS_LIMIT);
      return `<div class="flex h-2.5 items-center gap-2" data-bar-row><div data-bar data-w="${w}" data-tip="${tip}" tabindex="0" role="img" aria-label="${tip}" class="h-full rounded-r-[3px] transition-[width] duration-700 ease-out hover:brightness-125" style="width: ${w}; background: var(--color-series-${engine.series})"></div><span class="font-mono text-[10px] leading-none tabular-nums text-slate-300">${fps === null ? '–' : fps.toFixed(1)}</span></div>`;
    }).join('')}</div>
  </div>`).join('');
  return `<figure class="rounded-2xl bg-ink-950/50 p-4 ring-1 ring-white/5">
    ${panelHead('Frames per second at each resolution', 'higher', 'fps · same scene, four canvas sizes')}
    <div class="space-y-4">${rows}</div>
  </figure>`;
}

function cpuPanel(resolution, mode, count) {
  const values = engines.map((engine) => row(resolution, mode, count, engine.id));
  const max = Math.max(FRAME_BUDGET, ...values.filter(Boolean).map((r) => r.update + r.submit));
  const bars = engines.map((engine, i) => {
    const r = values[i];
    if (!r) return `<div class="grid grid-cols-[7.5rem_1fr] items-center gap-3 sm:grid-cols-[9rem_1fr]"><span class="truncate text-xs text-slate-300">${engine.short}</span><span class="text-xs text-slate-400">not measured</span></div>`;
    const total = r.update + r.submit;
    const tip = `${engine.label}: ${r.update.toFixed(1)} ms scene update + ${r.submit.toFixed(1)} ms draw submission = ${total.toFixed(1)} ms of CPU time per frame`;
    // Two segments of the engine's colour: solid for the update, faded for the submission.
    const seg = (ms, faded, rounded) => `<div data-bar data-w="${track(ms / max)}" data-tip="${tip}" ${faded ? '' : `tabindex="0" role="img" aria-label="${tip}"`} class="h-full ${rounded ? 'rounded-r-[4px]' : ''} transition-[width] duration-700 ease-out hover:brightness-125" style="width: ${track(ms / max)}; background: var(--color-series-${engine.series}); ${faded ? 'opacity: 0.45;' : ''}"></div>`;
    return `<div class="grid grid-cols-[7.5rem_1fr] items-center gap-3 sm:grid-cols-[9rem_1fr]">
      <span class="truncate text-xs text-slate-300">${engine.short}</span>
      <div class="flex h-6 items-center" data-bar-row>${seg(r.update, false, false)}<span class="h-full w-0.5 shrink-0"></span>${seg(r.submit, true, true)}<span class="ml-2 font-mono text-xs tabular-nums text-slate-200">${total.toFixed(1)}</span></div>
    </div>`;
  }).join('');
  const swatch = (faded, label) => `<span class="inline-flex items-center gap-1.5"><span class="h-2.5 w-4 rounded-sm bg-slate-300" style="${faded ? 'opacity: 0.45' : ''}"></span>${label}</span>`;
  return `<figure class="mt-6 rounded-2xl border border-dashed border-white/15 p-4">
    ${panelHead('Where the CPU time goes', 'lower', `ms per frame · ${resLabel(resolution)} · shorter bars mean less work`)}
    <div class="relative space-y-2.5 pt-5"><div class="pointer-events-none absolute inset-y-0 left-[8.25rem] right-0 sm:left-[9.75rem]">${limitLine(FRAME_BUDGET / max, '16.7 ms = one 60 fps frame')}</div>${bars}</div>
    <p class="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-400">${swatch(false, 'scene update: animation, transforms, world matrices')}${swatch(true, 'draw submission: the renderer’s CPU work')}</p>
    <p class="mt-2 text-xs leading-relaxed text-slate-400">This is the cost behind the frame rate above: CPU time past the dashed line cannot fit in a 60 fps frame. GPU time is not measured.</p>
  </figure>`;
}

export function legend() {
  return `<ul class="flex flex-wrap gap-x-5 gap-y-2" aria-label="Legend">${engines.map((engine) => `<li class="flex items-center gap-2 text-xs text-slate-300"><span class="size-2.5 rounded-sm" style="background: var(--color-series-${engine.series})"></span>${engine.label}</li>`).join('')}</ul>`;
}

function table(resolution, mode, count) {
  const cell = (v, d = 1) => `<td class="py-2 pr-3 text-right font-mono tabular-nums text-slate-200">${v === null || v === undefined ? '–' : v.toFixed(d)}</td>`;
  const body = engines.map((engine) => {
    const r = row(resolution, mode, count, engine.id);
    return `<tr class="border-t border-white/5"><td class="py-2 pr-3 text-slate-300">${engine.label}</td>${r ? cell(r.fps) + cell(r.update) + cell(r.submit) + cell(r.calls, 0) : '<td colspan="4" class="py-2 text-right text-slate-400">not measured</td>'}</tr>`;
  }).join('');
  return `<table class="w-full text-left text-sm"><caption class="sr-only">Showcase measurements for the selected resolution, mode and body count</caption>
    <thead class="font-mono text-[11px] uppercase tracking-wider text-slate-400"><tr><th class="py-2 pr-3 font-medium">Engine</th><th class="py-2 pr-3 text-right font-medium">fps ▲</th><th class="py-2 pr-3 text-right font-medium">update ms ▼</th><th class="py-2 pr-3 text-right font-medium">submit ms ▼</th><th class="py-2 pr-3 text-right font-medium">draw calls</th></tr></thead>
    <tbody>${body}</tbody></table>`;
}

// Everything below the controls; re-rendered when a control changes.
export function chartBody(resolution, mode, count) {
  return `<div class="grid grid-cols-1 gap-6 lg:grid-cols-2">${fpsPanel(resolution, mode, count)}${scalingPanel(mode, count)}</div>
    ${cpuPanel(resolution, mode, count)}
    <div class="mt-6 flex flex-col gap-4 border-t border-white/5 pt-5 sm:flex-row sm:items-start sm:justify-between">
      ${legend()}
      <details class="group min-w-0 text-sm sm:max-w-lg sm:text-right">
        <summary class="cursor-pointer list-none font-medium text-brand-cyan hover:text-white">Show as table</summary>
        <div class="relative mt-3 overflow-x-auto text-left">${table(resolution, mode, count)}</div>
      </details>
    </div>`;
}

function segmented(name, options, active, label, disabled = []) {
  return `<div role="radiogroup" aria-label="${label}" class="inline-flex flex-wrap rounded-full bg-white/5 p-1 ring-1 ring-white/10">${options.map(([value, text]) => `<button type="button" role="radio" aria-checked="${String(value) === String(active)}" data-chart-${name}="${value}"${disabled.includes(value) ? ' disabled' : ''} class="rounded-full px-3.5 py-1.5 text-xs font-medium transition aria-checked:bg-white aria-checked:text-ink-950 text-slate-300 hover:text-white disabled:cursor-not-allowed disabled:opacity-30">${text}</button>`).join('')}</div>`;
}

export function showcaseChart(mode = 'objects', count = 10000, resolution = defaultResolution) {
  return `<div class="glass rounded-3xl p-5 sm:p-8" data-chart data-mode="${mode}" data-count="${count}" data-resolution="${resolution}">
    <div class="mb-6 flex flex-col gap-4">
      <div>
        <h3 class="font-display text-xl font-semibold text-white">The showcase scene, four renderers</h3>
        <p class="mt-1 text-sm text-slate-400">Sun, belts, clusters and bodies: a four-level scene graph where every rotation changes each frame. Longer bars are better in the two frame-rate charts; the CPU chart below them is marked separately.</p>
      </div>
      <div class="flex flex-wrap gap-2">
        ${segmented('resolution', resolutions.map((r) => [r, resLabel(r)]), resolution, 'Canvas resolution')}
        ${segmented('mode', [['objects', 'Separate meshes'], ['instanced', 'Instanced']], mode, 'Draw mode')}
        ${segmented('count', counts.instanced.map((c) => [c, fmt(c)]), count, 'Number of bodies', mode === 'objects' ? [100000] : [])}
      </div>
    </div>
    <div data-chart-body>${chartBody(resolution, mode, count)}</div>
  </div>`;
}

// Speed of WAMR3D against three.js from two median times: a bar that grows right from the
// centre when WAMR3D is faster and left when it is slower, on a log scale so 4× faster and
// 4× slower are the same length. The label always says which, in words.
export function speedTable(rows, caption) {
  const speeds = rows.map(([, three, wamr]) => three / wamr);
  const span = Math.max(...speeds.map((s) => Math.abs(Math.log2(s))), 1);
  const label = (s) => s >= 1 ? `${s.toFixed(s < 10 ? 1 : 0)}× faster` : `${(1 / s).toFixed(1 / s < 10 ? 1 : 0)}× slower`;
  const th = 'py-3 pr-4 font-medium';
  const td = 'py-2.5 pr-4';
  const body = rows.map(([name, three, wamr], i) => {
    const s = speeds[i], faster = s >= 1;
    const w = `${(Math.abs(Math.log2(s)) / span * 50).toFixed(2)}%`;
    return `<tr class="border-t border-white/5">
      <td class="${td} pl-3 text-slate-300">${name}</td>
      <td class="${td} text-right font-mono tabular-nums text-slate-400">${three.toFixed(2)}</td>
      <td class="${td} text-right font-mono tabular-nums text-slate-400">${wamr.toFixed(2)}</td>
      <td class="${td} w-[34%] min-w-[11rem]"><div class="relative h-4" role="img" aria-label="WAMR3D ${label(s)} than three.js">
        <div class="absolute inset-y-[-3px] left-1/2 w-px bg-slate-400/60"></div>
        <div class="absolute inset-y-0 ${faster ? 'left-1/2 rounded-r-[4px]' : 'right-1/2 rounded-l-[4px]'}" style="width: ${w}; background: var(--color-series-${faster ? 3 : 2})"></div>
      </div></td>
      <td class="${td} whitespace-nowrap text-right font-mono text-xs tabular-nums ${faster ? 'text-emerald-300' : 'text-slate-300'}">${label(s)}</td>
    </tr>`;
  }).join('');
  return `<div class="glass relative overflow-x-auto rounded-3xl p-2 sm:p-4"><table class="w-full min-w-[44rem] text-left text-sm">
    <caption class="sr-only">${caption}</caption>
    <thead class="font-mono text-[11px] uppercase tracking-wider text-slate-400"><tr>
      <th class="${th} pl-3">Workload</th><th class="${th} text-right">three.js ms</th><th class="${th} text-right">WAMR3D ms</th>
      <th class="${th}"><span class="flex justify-between normal-case tracking-normal"><span>◀ slower</span><span>same</span><span>faster ▶</span></span></th><th class="${th} text-right">WAMR3D is</th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table></div>`;
}
