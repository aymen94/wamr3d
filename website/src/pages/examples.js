import { icon, pageIntro, repoFile, shell } from '../components/ui.js';

const demos = [
  { href: './examples/webgpu/', tag: 'WAMR3D only', title: 'WebGPU demo', body: 'A rotating scene with physically based materials, colour textures, lighting, fog, interactive camera movement and picking. No three.js on the page.', source: 'examples/webgpu/main.js', art: 'from-brand-violet/50 via-brand-blue/30 to-transparent' },
  { href: './examples/showcase/', tag: 'Up to 100,000 bodies', title: 'Showcase', body: 'A four-level scene graph of spinning belts. Change the body count, instancing, shading, lights and fog, switch between WAMR3D and three.js, and compare live timings.', source: 'examples/showcase/main.js', art: 'from-brand-cyan/40 via-brand-blue/30 to-transparent' },
  { href: './examples/compare/', tag: 'Side by side', title: 'Engine comparison', body: 'The same scene on WAMR3D and three.js with timing overlays. Run one engine at a time for measurement.', source: 'examples/compare/run.js', art: 'from-brand-blue/50 via-brand-violet/30 to-transparent' },
  { href: './examples/browser/', tag: 'Low-level API', title: 'Browser demo', body: 'The handle-based API driving a scene in the browser, with an optional transform check against three.js.', source: 'examples/browser/main.js', art: 'from-brand-violet/40 via-brand-cyan/20 to-transparent' },
  { href: './parity/visual/index.html', tag: '23 visual cases', title: 'Visual parity', body: 'From cubes, lights and textures to points, sprites, shadows, tone mapping and render targets, compared pixel by pixel with stored three.js images.', source: 'parity/visual/cases.js', art: 'from-brand-cyan/40 via-brand-violet/20 to-transparent' },
  { href: './examples/threejs/', tag: 'Reference', title: 'three.js baseline', body: 'The comparison scene drawn by three.js alone, loaded from a CDN: the reference the others are measured against.', source: 'examples/compare/run.js', art: 'from-slate-500/30 via-slate-700/20 to-transparent' }
];

export function examples() {
  return shell(`${pageIntro({ label: 'Live demos', title: 'Real scenes.<br><span class="text-gradient">Runnable code.</span>', intro: 'See the renderer in action, compare it with three.js, or dial the scene up to 100,000 moving bodies. The demos need a browser with WebGPU, such as current Chrome or Edge.' })}
  <div class="relative bg-gradient-to-b from-transparent via-ink-950/85 to-ink-950">
    <section class="mx-auto grid max-w-6xl gap-5 px-6 pb-24 md:grid-cols-2 lg:grid-cols-3">
      ${demos.map((demo, i) => `<article class="glass gradient-border group relative flex flex-col overflow-hidden rounded-3xl transition duration-500 hover:-translate-y-1" data-reveal style="--reveal-delay:${(i % 3) * 70}ms">
        <div class="grid-backdrop relative h-40 overflow-hidden"><div class="absolute inset-0 bg-gradient-to-br ${demo.art}"></div><span class="absolute bottom-4 left-5 font-mono text-[11px] uppercase tracking-[0.2em] text-white/80">${demo.tag}</span></div>
        <div class="flex flex-1 flex-col p-6">
          <h2 class="font-display text-xl font-semibold text-white"><a href="${demo.href}" class="after:absolute after:inset-0">${demo.title}</a></h2>
          <p class="mt-2 flex-1 text-sm leading-relaxed text-slate-400">${demo.body}</p>
          <div class="pointer-events-none relative z-10 mt-5 flex items-center justify-between text-sm">
            <span class="inline-flex items-center gap-1.5 font-semibold text-brand-cyan">Open demo ${icon('arrow')}</span>
            <a href="${repoFile(demo.source)}" target="_blank" rel="noreferrer" class="pointer-events-auto inline-flex items-center gap-1 text-slate-400 transition hover:text-white">Source ${icon('external')}</a>
          </div>
        </div>
      </article>`).join('')}
    </section>
  </div>`, 'examples');
}
