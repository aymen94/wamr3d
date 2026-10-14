import { icon, pageIntro, repoFile, shell } from '../components/ui.js';

// Ported pages run on WAMR3D; `?engine=three` runs the same code on three.js r186.
const port = (dir, tag, title, body, credit, original) => ({ href: `./examples/ports/${dir}/`, compare: `./examples/ports/${dir}/?engine=three`, image: `./images/examples/${dir}.jpg`, source: `examples/ports/${dir}/main.js`, tag, title, body, credit, original });

const sections = [
  {
    id: 'games',
    label: 'Games',
    title: 'Games that ran on three.js',
    intro: 'Browser games from published three.js tutorials, running on WAMR3D. The import is swapped for the WAMR3D one; the game code is the original.',
    items: [
      port('crossy-road', 'Arcade · keyboard and touch', 'Crossy Road', 'Hop across endless roads and forests. Procedural rows, cars and trucks, hit tests, directional shadows and canvas textures on multi-material boxes.', 'Hunor Márton Borbély', 'https://www.freecodecamp.org/news/how-to-code-a-crossy-road-game-clone-with-threejs/'),
      port('stack', 'Arcade · Cannon.js physics', 'Stack', 'Drop each sliding block on the tower; what overhangs is cut off and falls. Orthographic camera, with the Cannon.js physics engine left as it was.', 'Hunor Márton Borbély', 'https://codepen.io/HunorMarton/pen/MWjBRWp')
    ]
  },
  {
    id: 'scenes',
    label: 'Complex scenes',
    title: 'Bigger designs, same code',
    intro: 'Larger scenes from the three.js community and the official examples: hundreds of objects, merged terrain, spot-light shadows, fog and tweened animation.',
    items: [
      port('city', 'Procedural · GSAP', 'City 3D', 'A neon city of shadowed towers with 60 light streaks on GSAP tweens, 300 floating particles, fog and a grid floor. Move the mouse to tilt it.', 'Victor Vergara', 'https://codepen.io/vcomics/pen/aGmoae'),
      port('voxel-world', 'Procedural terrain', 'Voxel world', 'A 128 × 128 Minecraft-style landscape from Perlin noise, merged into a single textured mesh. Fly through it with the mouse and keyboard.', 'three.js authors', 'https://threejs.org/examples/#webgl_geometry_minecraft'),
      port('spotlights', 'Lights and shadows', 'Spotlights', 'Three coloured spot lights with PCF shadows, tweened to new cones and positions every five seconds. Drag to orbit.', 'three.js authors', 'https://threejs.org/examples/#webgl_lights_spotlights')
    ]
  },
  {
    id: 'threejs-examples',
    label: 'three.js examples',
    title: 'Official examples, library swapped',
    intro: 'Examples from threejs.org (r186). Each page lists what had to change besides the import, which is usually a material or add-on that WAMR3D does not have yet.',
    items: [
      port('interactive-cubes', '2,000 meshes · picking', 'Interactive cubes', 'Two thousand cubes picked with a Raycaster on every frame while the camera circles. Hover to highlight.', 'three.js authors', 'https://threejs.org/examples/#webgl_interactive_cubes'),
      port('triangles', '160,000 triangles', 'BufferGeometry triangles', 'One geometry with 160,000 separate triangles, flat normals and vertex colours, lit by two lights through fog.', 'three.js authors', 'https://threejs.org/examples/#webgl_buffergeometry'),
      port('points', '500,000 points', 'BufferGeometry points', 'Half a million vertex-coloured points in a single draw call, rotating in fog.', 'three.js authors', 'https://threejs.org/examples/#webgl_buffergeometry_points'),
      port('lines', '10,000 vertices', 'BufferGeometry lines', 'A 10,000-vertex coloured line that blends towards a second random shape, with its position attribute updated every frame.', 'three.js authors', 'https://threejs.org/examples/#webgl_buffergeometry_lines')
    ]
  },
  {
    id: 'engine',
    label: 'Engine and measurements',
    title: 'Measure it yourself',
    intro: 'Pages that test the engine itself: load, speed against three.js, and pixel accuracy.',
    items: [
      { href: './examples/showcase/', tag: 'Up to 100,000 bodies', title: 'Showcase', body: 'A four-level scene graph of spinning belts. Change the body count, instancing, shading, lights and fog, switch between WAMR3D and three.js, and compare live timings.', source: 'examples/showcase/main.js', art: 'from-brand-cyan/40 via-brand-blue/30 to-transparent' },
      { href: './examples/compare/', tag: 'Side by side', title: 'Engine comparison', body: 'The same scene on WAMR3D and three.js (WebGPU and WebGL) with timing overlays, including the three.js-only baseline. Run one engine at a time for measurement.', source: 'examples/compare/run.js', art: 'from-brand-blue/50 via-brand-violet/30 to-transparent' },
      { href: './examples/browser/', tag: 'Low-level API', title: 'Browser demo', body: 'The handle-based API driving a scene in the browser, with an optional transform check against three.js.', source: 'examples/browser/main.js', art: 'from-brand-violet/40 via-brand-cyan/20 to-transparent' },
      { href: './parity/visual/index.html', tag: '23 visual cases', title: 'Visual parity', body: 'From cubes, lights and textures to points, sprites, shadows, tone mapping and render targets, compared pixel by pixel with stored three.js images.', source: 'parity/visual/cases.js', art: 'from-brand-cyan/40 via-brand-violet/20 to-transparent' }
    ]
  }
];

function card(demo, i) {
  const art = demo.image
    ? `<img src="${demo.image}" alt="" loading="lazy" width="640" height="360" class="absolute inset-0 size-full object-cover transition duration-700 group-hover:scale-105"><div class="absolute inset-0 bg-gradient-to-t from-ink-950/85 via-ink-950/10 to-transparent"></div>`
    : `<div class="absolute inset-0 bg-gradient-to-br ${demo.art}"></div>`;
  const credit = demo.credit ? `<p class="mt-3 text-xs text-slate-400">Original by <a href="${demo.original}" target="_blank" rel="noreferrer" class="pointer-events-auto relative z-10 text-slate-300 underline-offset-4 hover:text-white hover:underline">${demo.credit}</a></p>` : '';
  const compare = demo.compare ? `<a href="${demo.compare}" target="_blank" rel="noreferrer" class="pointer-events-auto inline-flex items-center gap-1 text-slate-400 transition hover:text-white">On three.js ${icon('arrow')}</a>` : '';
  return `<article class="glass gradient-border group relative flex flex-col overflow-hidden rounded-3xl transition duration-500 hover:-translate-y-1" data-reveal style="--reveal-delay:${(i % 3) * 70}ms">
    <div class="grid-backdrop relative aspect-[16/9] overflow-hidden">${art}<span class="absolute bottom-4 left-5 font-mono text-[11px] uppercase tracking-[0.2em] text-white/90">${demo.tag}</span></div>
    <div class="flex flex-1 flex-col p-6">
      <h3 class="font-display text-xl font-semibold text-white"><a href="${demo.href}" target="_blank" rel="noreferrer" class="after:absolute after:inset-0">${demo.title}</a></h3>
      <p class="mt-2 flex-1 text-sm leading-relaxed text-slate-400">${demo.body}</p>
      ${credit}
      <div class="pointer-events-none relative z-10 mt-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm">
        <span class="inline-flex items-center gap-1.5 font-semibold text-brand-cyan">Open demo ${icon('arrow')}</span>
        <span class="flex items-center gap-4">${compare}<a href="${repoFile(demo.source)}" target="_blank" rel="noreferrer" class="pointer-events-auto inline-flex items-center gap-1 text-slate-400 transition hover:text-white">Source ${icon('external')}</a></span>
      </div>
    </div>
  </article>`;
}

export function examples() {
  return shell(`${pageIntro({ label: 'Live demos', title: 'Real scenes.<br><span class="text-gradient">Runnable code.</span>', intro: 'Games and scenes written for three.js, running on WAMR3D with the import changed, plus pages that measure the engine. Each port can switch to three.js r186 for comparison. The demos need a browser with WebGPU, such as current Chrome or Edge.' })}
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
    <p class="mx-auto max-w-6xl px-6 pb-24 text-xs leading-relaxed text-slate-400">Ported code keeps its authors' licences and credits: see <a class="text-brand-cyan hover:text-white" href="${repoFile('THIRD_PARTY.md')}" target="_blank" rel="noreferrer">THIRD_PARTY.md</a>. WAMR3D is not affiliated with the original authors.</p>
  </div>`, 'examples');
}
