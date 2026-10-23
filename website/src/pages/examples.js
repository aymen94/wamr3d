import { icon, pageIntro, repoFile, shell } from '../components/ui.js';

const sections = [
  {
    id: 'engine',
    label: 'Engine and measurements',
    title: 'Measure it yourself',
    intro: 'Pages that test the engine itself: load, speed against three.js, and pixel accuracy.',
    items: [
      { href: './examples/showcase/', tag: 'Up to 100,000 bodies', title: 'Showcase', body: 'A four-level scene graph of spinning belts. Change the body count, instancing, shading, lights and fog, switch between WAMR3D and three.js, and compare live timings.', source: 'examples/showcase/main.js', art: 'from-brand-cyan/40 via-brand-blue/30 to-transparent' },
      { href: './examples/compare/', tag: 'Side by side', title: 'Engine comparison', body: 'The same scene on WAMR3D and three.js (WebGPU and WebGL) with timing overlays, including the three.js-only baseline. Run one engine at a time for measurement.', source: 'examples/compare/run.js', art: 'from-brand-blue/50 via-brand-violet/30 to-transparent' },
      { href: './examples/browser/', tag: 'Low-level API', title: 'Browser demo', body: 'The handle-based API driving a scene in the browser, with an optional transform check against three.js.', source: 'examples/browser/main.js', art: 'from-brand-violet/40 via-brand-cyan/20 to-transparent' },
      { href: './parity/visual/index.html', tag: '37 visual cases', title: 'Visual parity', body: 'From cubes, lights and textures to points, sprites, shadows, tone mapping and render targets, compared pixel by pixel with stored three.js images.', source: 'parity/visual/cases.js', art: 'from-brand-cyan/40 via-brand-violet/20 to-transparent' }
    ]
  }
];

function card(demo, i) {
  const art = `<div class="absolute inset-0 bg-gradient-to-br ${demo.art}"></div>`;
  return `<article class="glass gradient-border group relative flex flex-col overflow-hidden rounded-3xl transition duration-500 hover:-translate-y-1" data-reveal style="--reveal-delay:${(i % 3) * 70}ms">
    <div class="grid-backdrop relative aspect-[16/9] overflow-hidden">${art}<span class="absolute bottom-4 left-5 font-mono text-[11px] uppercase tracking-[0.2em] text-white/90">${demo.tag}</span></div>
    <div class="flex flex-1 flex-col p-6">
      <h3 class="font-display text-xl font-semibold text-white"><a href="${demo.href}" target="_blank" rel="noreferrer" class="after:absolute after:inset-0">${demo.title}</a></h3>
      <p class="mt-2 flex-1 text-sm leading-relaxed text-slate-400">${demo.body}</p>
      <div class="pointer-events-none relative z-10 mt-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm">
        <span class="inline-flex items-center gap-1.5 font-semibold text-brand-cyan">Open demo ${icon('arrow')}</span>
        <span class="flex items-center gap-4"><a href="${repoFile(demo.source)}" target="_blank" rel="noreferrer" class="pointer-events-auto inline-flex items-center gap-1 text-slate-400 transition hover:text-white">Source ${icon('external')}</a></span>
      </div>
    </div>
  </article>`;
}

export function examples() {
  return shell(`${pageIntro({ label: 'Live demos', title: 'Engine tools.<br><span class="text-gradient">Runnable code.</span>', intro: 'Browser demos for the engine, its API and visual parity checks. The benchmark page reports measured performance separately.' })}
  <div class="relative bg-gradient-to-b from-transparent via-ink-950/85 to-ink-950">
    <nav class="mx-auto flex max-w-6xl flex-wrap gap-2 px-6 pb-10" aria-label="Demo sections">
      ${sections.map((s) => `<a href="#/examples#${s.id}" class="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-300 transition hover:bg-white/10 hover:text-white">${s.label} <span class="ml-1 font-mono text-xs text-slate-400">${s.items.length}</span></a>`).join('')}
    </nav>
    ${sections.map((s) => `<section id="${s.id}" class="mx-auto max-w-6xl scroll-mt-28 px-6 pb-20" aria-labelledby="${s.id}-title">
      <div class="mb-8 max-w-2xl" data-reveal>
        <p class="font-mono text-[11px] uppercase tracking-[0.2em] text-brand-cyan">${s.label}</p>
        <h2 id="${s.id}-title" class="mt-2 font-display text-2xl font-semibold text-white sm:text-3xl">${s.title}</h2>
        <p class="mt-3 text-sm leading-relaxed text-slate-400">${s.intro}</p>
      </div>
      <div class="grid gap-5 md:grid-cols-2 lg:grid-cols-3">${s.items.map(card).join('')}</div>
    </section>`).join('')}
  </div>`, 'examples');
}
