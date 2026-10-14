import { button, codeBlock, eyebrow, icon, installChip, miniCube, repoFile, sectionHead, shell } from '../components/ui.js';
import { showcaseChart } from '../components/charts.js';
import { lowLevel, meta, showcase } from '../data/benchmarks.js';

// The home page quotes one resolution; the benchmarks page has all of them.
const HEADLINE = '1920x1080';

const migrationDiff = `- import * as THREE from 'three';
+ import * as THREE from 'wamr3d/compat';
+ await THREE.init();

  const scene = new THREE.Scene();
  const mesh = new THREE.Mesh( geometry, material );
  scene.add( mesh );

- const renderer = new THREE.WebGLRenderer( { antialias: true } );
+ const renderer = new THREE.WebGPURenderer( { antialias: true } );
+ await renderer.init();`;

const quickStart = `import * as WAMR3D from 'wamr3d/compat';

await WAMR3D.init();

const scene = new WAMR3D.Scene();
const camera = new WAMR3D.PerspectiveCamera( 50, innerWidth / innerHeight, 0.1, 100 );
camera.position.set( 3, 2, 5 );
camera.lookAt( 0, 0, 0 );

const cube = new WAMR3D.Mesh( new WAMR3D.BoxGeometry(), new WAMR3D.MeshLambertMaterial( { color: 0x4f8cff } ) );
scene.add( cube, new WAMR3D.DirectionalLight( 0xffffff, 2 ), new WAMR3D.HemisphereLight( 0xbfd4ff, 0x30281e, 1 ) );

const renderer = new WAMR3D.WebGPURenderer( { antialias: true } );
await renderer.init();
renderer.setSize( innerWidth, innerHeight );
document.body.appendChild( renderer.domElement );

renderer.setAnimationLoop( ( time ) => {
  cube.rotation.y = time / 1000;
  renderer.render( scene, camera );
} );`;

function hero() {
  return `<section class="relative flex min-h-[100svh] items-center px-6 pb-20 pt-36 sm:pt-40" aria-labelledby="hero-title">
    <div class="mx-auto w-full max-w-6xl">
      <div class="max-w-2xl">
        <div data-scene-status class="glass mb-8 inline-flex items-center gap-2.5 rounded-full px-3.5 py-1.5 font-mono text-[11px] text-slate-300" role="status" aria-live="polite">
          <span class="size-2 animate-pulse-dot rounded-full bg-brand-cyan" aria-hidden="true"></span>
          <span data-scene-text>Starting the WAMR3D WebGPU renderer…</span>
        </div>
        <h1 id="hero-title" class="font-display text-[2.5rem] font-semibold leading-[1.03] tracking-tight text-white sm:text-6xl lg:text-[4.1rem]">
          The 3D engine you already know.
          <span class="text-gradient animate-shine block">Compiled to WebAssembly.</span>
        </h1>
        <p class="mt-7 max-w-xl text-lg leading-relaxed text-slate-300 sm:text-xl">
          WAMR3D is a fast 3D engine for the web: a Rust core compiled to WebAssembly, its own WebGPU renderer, and classes that read like three.js. Change the import, call <code class="font-mono text-brand-cyan">init()</code>, switch to WebGPU, and keep the code you know.
        </p>
        <div class="mt-9 flex flex-wrap items-center gap-3">
          ${button('#install', 'Get started')}
          ${button('#/examples', 'See live demos', 'secondary')}
        </div>
        ${installChip('mt-6')}
        <ul class="mt-10 flex flex-wrap gap-x-6 gap-y-2 font-mono text-[11px] uppercase tracking-[0.16em] text-slate-400">
          <li>MIT license</li><li>No runtime dependencies</li><li>488 KiB Wasm</li><li>Checked against three.js</li>
        </ul>
      </div>
    </div>
    <p data-scene-hint class="pointer-events-none absolute bottom-8 right-6 hidden max-w-xs text-right font-mono text-[11px] leading-relaxed text-slate-400 lg:block">
      Live scene drawn by WAMR3D. Move the pointer to bend the field,<br>hover the cube, click anywhere empty to send a ripple.
    </p>
    <a href="#migration-preview" class="group absolute bottom-8 left-1/2 hidden -translate-x-1/2 flex-col items-center gap-2 text-slate-400 transition hover:text-white sm:flex" aria-label="Scroll to content">
      ${miniCube}
      <span class="relative h-10 w-px bg-gradient-to-b from-transparent via-slate-500 to-transparent">
        <span class="absolute left-1/2 top-0 size-1.5 animate-scroll-dot rounded-full bg-brand-cyan"></span>
      </span>
    </a>
  </section>`;
}

function migrationPreview() {
  const steps = [
    ['Change the import', 'Point <code class="font-mono text-brand-cyan">three</code> at <code class="font-mono text-brand-cyan">wamr3d/compat</code> and call <code class="font-mono text-brand-cyan">init()</code> once.'],
    ['Swap the renderer', 'Use <code class="font-mono text-brand-cyan">WebGPURenderer</code> and <code class="font-mono text-brand-cyan">await renderer.init()</code>. There is no WebGL renderer.'],
    ['Keep your scene code', '<code class="font-mono text-brand-cyan">scene.add</code>, <code class="font-mono text-brand-cyan">position.set</code>, <code class="font-mono text-brand-cyan">rotation.y +=</code>, <code class="font-mono text-brand-cyan">lookAt</code> and raycasting work as written for supported classes.']
  ];
  return `<section id="migration-preview" class="relative px-6 py-20">
    <div class="mx-auto grid max-w-6xl grid-cols-1 items-center gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div>
        ${sectionHead({ label: 'Migration path', title: 'Start from three.js.<br><span class="text-gradient">Change the import.</span>', intro: 'Scene, meshes, lights, shadows, materials and math keep their three.js names, properties and chaining. A parity script runs the same code on both libraries and compares every number.' })}
        <ol class="space-y-5">
          ${steps.map(([title, body], i) => `<li class="flex gap-4" data-reveal style="--reveal-delay:${i * 80}ms"><span class="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-violet/30 to-brand-cyan/20 font-mono text-sm text-white ring-1 ring-white/10">0${i + 1}</span><div><h3 class="font-semibold text-white">${title}</h3><p class="mt-1 text-sm leading-relaxed text-slate-400">${body}</p></div></li>`).join('')}
        </ol>
        <div class="mt-8" data-reveal>${button('#/migration', 'Read the migration guide', 'secondary')}</div>
      </div>
      <div data-reveal class="lg:animate-float">${codeBlock(migrationDiff, { title: 'app.js', diff: true })}</div>
    </div>
  </section>`;
}

function features() {
  const card = (span, label, title, body, extra = '') => `<article class="glass gradient-border group relative overflow-hidden rounded-3xl p-7 transition duration-500 hover:-translate-y-1 hover:bg-white/[0.06] ${span}" data-reveal>
    <div class="pointer-events-none absolute -right-20 -top-20 size-56 rounded-full bg-brand-blue/20 opacity-0 blur-3xl transition-opacity duration-700 group-hover:opacity-100"></div>
    <p class="font-mono text-[11px] uppercase tracking-[0.2em] text-brand-cyan">${label}</p>
    <h3 class="mt-3 font-display text-2xl font-semibold text-white">${title}</h3>
    <p class="mt-3 leading-relaxed text-slate-400">${body}</p>${extra}
  </article>`;
  const chips = (items) => `<ul class="mt-5 flex flex-wrap gap-2">${items.map((item) => `<li class="rounded-full bg-white/5 px-3 py-1 font-mono text-[11px] text-slate-300 ring-1 ring-white/10">${item}</li>`).join('')}</ul>`;
  return `<section id="features" class="relative scroll-mt-24 px-6 py-20">
    <div class="mx-auto max-w-6xl">
      ${sectionHead({ label: 'What it is', title: 'A native core.<br><span class="text-gradient">A familiar surface.</span>', intro: 'Scene graph, transforms, cameras, geometry processing, culling and draw ordering run inside a WebAssembly module. You drive it from JavaScript through three.js-style classes or batched calls.' })}
      <div class="grid gap-5 md:grid-cols-6">
        ${card('md:col-span-4', 'Rust → WebAssembly', 'The heavy lifting runs native.', 'Set transforms as cheaply as in three.js: the object API batches every change into the Rust engine once per frame. When you need more, the low-level API gives you handles, explicit disposal and zero-copy typed-array views of geometry and world matrices.', chips(['scene graph', 'world matrices', 'frustum culling', 'draw ordering', 'raycasting', 'batched updates']))}
        ${card('md:col-span-2', 'WebGPU', 'Its own renderer.', 'Not a wrapper around three.js. Meshes, lines, points, sprites and instanced meshes; basic, Lambert and standard materials; colour textures, fog, up to 16 lights, PCF shadows, tone mapping, render targets and 4× MSAA.')}
        ${card('md:col-span-2', 'Object API', 'Code that reads like three.js.', 'Scene, Group, Mesh, InstancedMesh, Points, Sprite, render targets, cameras, eight shapes, six materials, textures, five light types, shadows, tone mapping, Raycaster, Clock and the math types.')}
        ${card('md:col-span-2', 'Batched API', 'One call, thousands of objects.', 'Handles and batched calls such as <code class="font-mono text-slate-200">setRotations</code>; read world matrices and geometry through typed-array views over engine memory, with no copy.')}
        ${card('md:col-span-2', 'Parity', 'Checked against.', 'Over 7,600 reference cases generated from the three.js source are replayed against the Rust code. All 23 renderer cases are compared with stored three.js images.')}
        ${card('md:col-span-6', 'Roadmap', 'Coming next.', 'Everything above ships today. These are still on the way; keep three.js for them for now:', `<ul class="mt-5 grid gap-x-8 gap-y-2 text-sm text-slate-300 sm:grid-cols-2 lg:grid-cols-3">${['Environment maps in the object API', 'Normal, roughness and other texture maps', 'Point-light shadows and area lights', 'Phong, Physical, Toon and Shader materials', 'Post-processing and scene background textures', 'Shadow modes other than PCF', 'Most loaders, animation, audio and controls', 'Lines and points wider than one pixel', 'A WebGL fallback'].map((item) => `<li class="flex items-center gap-2"><span class="text-slate-400">${icon('cross')}</span>${item}</li>`).join('')}</ul>`)}
      </div>
    </div>
  </section>`;
}

function performance() {
  const sep = showcase[HEADLINE].objects[10000], inst = showcase[HEADLINE].instanced[50000];
  const res = HEADLINE.replace('x', '×');
  const mathRatios = lowLevel.filter(([name]) => /^(Matrix4|Vector3)\./.test(name)).map((row) => row[3]);
  const stat = (value, unit, label, detail) => `<div class="glass gradient-border rounded-3xl p-7" data-reveal>
    <p class="font-display text-5xl font-semibold tracking-tight text-white">${value}<span class="ml-1 text-2xl text-slate-400">${unit}</span></p>
    <p class="mt-3 font-semibold text-slate-200">${label}</p>
    <p class="mt-2 text-sm leading-relaxed text-slate-400">${detail}</p>
  </div>`;
  return `<section id="performance" class="relative px-6 py-20">
    <div class="mx-auto max-w-6xl">
      ${sectionHead({ label: 'Measured, not promised', title: 'Batch the work.<br><span class="text-gradient">See the difference.</span>', intro: 'The same scene, four renderers, one engine at a time. These are medians from a single run on one machine; open the showcase to measure yours.' })}
      <div class="mb-8 grid gap-5 md:grid-cols-3">
        ${stat(sep.batched.fps.toFixed(0), 'fps', `10,000 separate meshes at ${res}`, `WAMR3D batched. three.js ran at ${sep.webgl.fps.toFixed(1)} fps with WebGL and ${sep.webgpu.fps.toFixed(1)} fps with WebGPU.`)}
        ${stat(inst.batched.update.toFixed(1), 'ms', `Scene update, 50,000 instanced bodies at ${res}`, `WAMR3D batched API (${inst.batched.fps.toFixed(1)} fps), against ${inst.webgpu.update.toFixed(1)} ms (WebGPU, ${inst.webgpu.fps.toFixed(1)} fps) and ${inst.webgl.update.toFixed(1)} ms (WebGL, ${inst.webgl.fps.toFixed(1)} fps) for three.js.`)}
        ${stat((sep.webgl.submit / sep.batched.submit).toFixed(1), '×', 'Draw submission speed against three.js WebGL', `10,000 meshes at ${res}: ${sep.batched.submit.toFixed(1)} ms against ${sep.webgl.submit.toFixed(1)} ms of CPU time. Ratio computed from the measured medians.`)}
      </div>
      <div data-reveal>${showcaseChart('objects', 10000, HEADLINE)}</div>
      <p class="mt-5 text-sm leading-relaxed text-slate-400" data-reveal>These benchmark runs predate the shadow, tone mapping, points, sprite and render-target features listed in <a class="text-brand-cyan hover:text-white" href="${repoFile('STATUS.md')}" target="_blank" rel="noreferrer">STATUS.md</a>; they measure the showcase workloads, not the performance of the newly added effects.</p>
      <div class="mt-8 grid grid-cols-1 gap-5 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <p class="text-sm leading-relaxed text-slate-400" data-reveal><strong class="text-slate-200">Where it is slower:</strong> calls that do very little work, such as a single vector operation or one property at a time, cost more than plain JavaScript because crossing into WebAssembly has a fixed cost. ${mathRatios.length ? `Single math calls measured ${Math.min(...mathRatios).toFixed(1)}× to ${Math.max(...mathRatios).toFixed(1)}× slower than three.js.` : ''} GPU time is not measured; it only shows in the frame rate.</p>
        <p class="font-mono text-[11px] leading-relaxed text-slate-400 md:text-right" data-reveal>${meta.cpu}, ${meta.gpu.replace(/ \(0x.*$/, '')}, ${meta.chrome} headless, ${meta.os}.<br>Measured ${meta.date} at 1280×720 to 3840×2160. Raw logs: <a class="text-brand-cyan hover:text-white" href="${repoFile('bench/results/2026-10-14')}" target="_blank" rel="noreferrer">bench/results/2026-10-14</a>.</p>
      </div>
      <div class="mt-8" data-reveal>${button('#/benchmarks', 'All benchmark results', 'secondary')}</div>
    </div>
  </section>`;
}

function liveDemo() {
  const others = [
    ['./examples/showcase/', 'Showcase', 'Up to 100,000 animated bodies. Switch between WAMR3D and three.js and compare live timings.'],
    ['./examples/compare/', 'Side by side', 'The same scene on each engine, with timing overlays.'],
    ['./parity/visual/index.html', 'Visual parity', 'WAMR3D renders compared pixel by pixel with three.js images.']
  ];
  return `<section id="demo" class="relative px-6 py-20">
    <div class="mx-auto max-w-6xl">
      ${sectionHead({ label: 'Live demos', title: 'Running in your browser.<br><span class="text-gradient">Right now.</span>', intro: 'Every demo below is drawn by the WAMR3D WebGPU renderer, except the three.js engines you choose to compare against.' })}
      <div class="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div class="gradient-border relative aspect-[16/10] overflow-hidden rounded-3xl bg-ink-900" data-reveal data-demo>
          <div class="grid-backdrop absolute inset-0 flex flex-col items-center justify-center gap-5 p-8 text-center" data-demo-poster>
            <p class="font-mono text-[11px] uppercase tracking-[0.2em] text-brand-cyan">WAMR3D · WebGPU</p>
            <p class="max-w-sm font-display text-2xl font-semibold text-white">Physically based materials, textures, lights, fog, interactive camera movement and picking.</p>
            <button type="button" data-demo-start class="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-ink-950 transition hover:bg-brand-cyan">
              <svg viewBox="0 0 20 20" class="size-4" fill="currentColor" aria-hidden="true"><path d="M6 4.5v11l9-5.5Z"/></svg>Start the live demo
            </button>
            <a href="./examples/webgpu/" class="text-xs text-slate-400 underline-offset-4 hover:text-white hover:underline">or open it full screen</a>
          </div>
        </div>
        <div class="flex flex-col gap-4">
          ${others.map(([href, title, body], i) => `<a href="${href}" class="glass group flex flex-1 flex-col justify-between rounded-3xl p-6 transition hover:-translate-y-0.5 hover:bg-white/[0.07]" data-reveal style="--reveal-delay:${i * 80}ms"><div><h3 class="flex items-center justify-between font-display text-lg font-semibold text-white">${title}<span class="text-slate-400 transition group-hover:text-brand-cyan">${icon('external')}</span></h3><p class="mt-2 text-sm leading-relaxed text-slate-400">${body}</p></div></a>`).join('')}
        </div>
      </div>
      <p class="mt-5 text-sm text-slate-400">The demos need a browser with WebGPU, such as current Chrome or Edge.</p>
    </div>
  </section>`;
}

function install() {
  return `<section id="install" class="relative scroll-mt-24 px-6 py-20">
    <div class="mx-auto grid max-w-6xl grid-cols-1 gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
      <div>
        ${sectionHead({ label: 'Get started', title: 'Install.<br><span class="text-gradient">Import. Render.</span>', intro: 'The package ships the WebAssembly module, the object API, the low-level API and TypeScript typings.' })}
        <div class="space-y-6" data-reveal>
          ${installChip()}
          <dl class="space-y-4 text-sm">
            <div><dt class="font-semibold text-white">Rendering</dt><dd class="mt-1 text-slate-400">A browser with WebGPU (current Chrome or Edge). Pages must be served over HTTP, not opened from <code class="font-mono">file://</code>.</dd></div>
            <div><dt class="font-semibold text-white">Without a renderer</dt><dd class="mt-1 text-slate-400">Node.js 18 or newer runs the math and the scene graph.</dd></div>
            <div><dt class="font-semibold text-white">Resolving the package</dt><dd class="mt-1 text-slate-400">Use a bundler or an import map for the <code class="font-mono">wamr3d</code> name.</dd></div>
            <div><dt class="font-semibold text-white">TypeScript</dt><dd class="mt-1 text-slate-400">Typings are included. Set <code class="font-mono">"lib": [ "esnext", "dom" ]</code>.</dd></div>
          </dl>
          <div class="flex flex-wrap gap-3">${button('#/docs', 'Read the docs', 'secondary')}${button('https://www.npmjs.com/package/wamr3d', 'View on npm', 'ghost', true)}</div>
        </div>
      </div>
      <div data-reveal>${codeBlock(quickStart, { title: 'main.js' })}</div>
    </div>
  </section>`;
}

function closing() {
  return `<section class="relative px-6 py-20">
    <div class="gradient-border glass relative mx-auto max-w-6xl overflow-hidden rounded-[2rem] px-8 py-16 text-center sm:px-16" data-reveal>
      <div class="pointer-events-none absolute inset-x-0 -top-32 mx-auto h-64 max-w-xl rounded-full bg-gradient-to-r from-brand-violet/40 via-brand-blue/40 to-brand-cyan/40 blur-3xl"></div>
      ${eyebrow('Open source · MIT')}
      <h2 class="relative font-display text-3xl font-semibold tracking-tight text-white sm:text-5xl">Bring your scene.<br><span class="text-gradient">Measure it yourself.</span></h2>
      <p class="relative mx-auto mt-5 max-w-xl text-lg text-slate-400">Run your three.js scene on WAMR3D's WebGPU renderer, compare the numbers, then batch the hot paths as your scene grows.</p>
      <div class="relative mt-9 flex flex-wrap justify-center gap-3">${button('#install', 'Get started')}${button('https://github.com/aymen94/wamr3d', 'Star on GitHub', 'secondary', true)}</div>
    </div>
  </section>`;
}

export function home() {
  return shell(`${hero()}<div class="relative bg-gradient-to-b from-transparent via-ink-950/80 to-ink-950">${migrationPreview()}${features()}${performance()}${liveDemo()}${install()}${closing()}</div>`, 'home');
}
