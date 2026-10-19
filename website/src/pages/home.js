import { button, codeBlock, eyebrow, icon, installChip, miniCube, repoFile, sectionHead, shell } from '../components/ui.js';
import { showcaseChart } from '../components/charts.js';
import { engines, lowLevel, meta, showcase, startup } from '../data/benchmarks.js';

// The home page quotes one resolution; the benchmarks page has all of them.
const HEADLINE = '1280x720';

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

// What the letters can stand for. The reel lands on each in turn, first letters lit.
const ACRONYMS = [
  'WebAssembly Accelerated Modular Rendering 3D',
  'WebAssembly Advanced Mesh Renderer 3D',
  'WebAssembly Matrix Rendering 3D',
  'WebAssembly Multi-platform Renderer 3D',
  'WebAssembly Accelerated Modeling & Rendering 3D',
  'WebAssembly Animation & Mesh Runtime 3D',
  'WebAssembly-native Advanced Modular Renderer 3D'
];

const initials = (name) => name.replace(/(^|\s)([A-Za-z0-9])/g, (_, gap, letter) => `${gap}<span class="text-brand-cyan">${letter}</span>`);

function acronymReel() {
  // Two full rounds plus two spare names: a spin runs one round past the target, may
  // overshoot by part of a row, then rests on the same name in the first round.
  const names = [...ACRONYMS, ...ACRONYMS, ACRONYMS[0], ACRONYMS[1]];
  return `<p class="mt-6 flex items-center gap-3 font-display text-[min(3.6vw,1.5rem)] font-semibold">
    <span class="hidden shrink-0 text-white sm:inline">WAMR3D</span><span class="hidden shrink-0 text-slate-500 sm:inline" aria-hidden="true">=</span>
    <span class="sr-only">${ACRONYMS[0]}</span>
    <span data-reel data-count="${ACRONYMS.length}" class="relative block h-[1.4em] min-w-0 overflow-hidden" aria-hidden="true">
      <span data-reel-strip class="block">${names.map((name) => `<span class="block h-[1.4em] truncate leading-[1.4em] text-slate-200">${initials(name)}</span>`).join('')}</span>
    </span>
  </p>`;
}

function hero() {
  return `<section class="relative flex min-h-[100svh] items-center px-6 pb-20 pt-36 sm:pt-40" aria-labelledby="hero-title">
    <div class="mx-auto w-full max-w-6xl">
      <div class="max-w-2xl">
        <div data-scene-status class="glass mb-8 inline-flex items-center gap-2.5 rounded-full px-3.5 py-1.5 font-mono text-[11px] text-slate-300" role="status" aria-live="polite">
          <span class="size-2 animate-pulse-dot rounded-full bg-brand-cyan" aria-hidden="true"></span>
          <span data-scene-text>Starting the WAMR3D renderer…</span>
        </div>
        <h1 id="hero-title" class="font-display text-[2.5rem] font-semibold leading-[1.03] tracking-tight text-white sm:text-6xl lg:text-[4.1rem]">
          Unlock your imagination without limits.
          <span class="text-gradient animate-shine block">Native WebAssembly 3D.</span>
        </h1>
        <p class="mt-6 max-w-lg text-lg leading-relaxed text-slate-300">
          A Rust 3D engine in WebAssembly with the three.js API. Change the import, call <code class="font-mono text-brand-cyan">init()</code>, keep your code.
        </p>
        ${acronymReel()}
        <div class="mt-8 flex flex-wrap items-center gap-3">
          ${button('#install', 'Get started')}
          ${button('#/examples', 'See live demos', 'secondary')}
        </div>
        ${installChip('mt-6')}
        <ul class="mt-10 flex flex-wrap gap-x-6 gap-y-2 font-mono text-[11px] uppercase tracking-[0.16em] text-slate-400">
          <li>MIT license</li><li>No runtime dependencies</li><li>${startup?.wasmKiB ?? 567} KiB Wasm</li><li>Checked against three.js</li>
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
    ['Swap the renderer', 'Use <code class="font-mono text-brand-cyan">WebGPURenderer</code> and <code class="font-mono text-brand-cyan">await renderer.init()</code>. It draws with WebGPU, or WebGL 2 where WebGPU is missing; <code class="font-mono text-brand-cyan">WebGLRenderer</code> works too.'],
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
        ${card('md:col-span-4', 'Rust → WebAssembly', 'Batch the scene work.', 'The engine handles scene graphs, transforms, cameras, geometry processing, culling and draw ordering. The familiar object API batches updates once per frame; the low-level API offers generational handles and typed-array views over engine memory.', chips(['scene graph', 'world matrices', 'frustum culling', 'draw ordering', 'raycasting', 'batched updates']))}
        ${card('md:col-span-2', 'WebGPU + WebGL 2', 'Two native renderers.', 'WAMR3D prepares frames in Rust and draws them through its own WebGPU or WebGL 2 renderer. The renderer supports meshes, lines, points, sprites and instancing, with a growing set of materials, maps, lights and shadows.')}
        ${card('md:col-span-2', 'Object API', 'A familiar way to build scenes.', 'Use three.js-style classes and chaining for supported scene, object, camera, geometry, material and math APIs. Object transforms stay in JavaScript and synchronize with the engine in batches.')}
        ${card('md:col-span-2', 'Batched API', 'Fewer calls for large scenes.', 'Use generational handles and batched operations when many objects change each frame. Geometry and world-matrix data can be read through typed-array views over engine memory.')}
        ${card('md:col-span-2', 'Parity', 'Behavior checked against three.js.', 'The repository includes thousands of generated value checks and stored visual comparisons. See the implementation status and migration guide for current support and known differences.')}
        ${card('md:col-span-6', 'Current scope', 'Release 0.9.1', 'WAMR3D 0.9.1 covers three.js\'s scene graph, built-in materials, lights, shadows, animation, loaders and the common add-ons, but it is not a complete replacement: TSL node materials are not ported, and GLSL shader materials draw only on WebGL 2. Check the repository status for the full list of limits.')}
      </div>
    </div>
  </section>`;
}

function pipeline() {
  const step = (tag, title, body, items) => `<article class="glass gradient-border flex flex-col rounded-3xl p-7" data-reveal>
    <p class="font-mono text-[11px] uppercase tracking-wider text-brand-cyan">${tag}</p>
    <h3 class="mt-3 font-display text-2xl font-semibold text-white">${title}</h3>
    <p class="mt-3 text-sm leading-relaxed text-slate-400">${body}</p>
    <ul class="mt-5 space-y-2 text-sm text-slate-300">${items.map((item) => `<li class="flex gap-2"><span class="text-brand-cyan" aria-hidden="true">▸</span>${item}</li>`).join('')}</ul>
  </article>`;
  return `<section id="cpu-gpu" class="relative scroll-mt-24 px-6 py-20">
    <div class="mx-auto max-w-6xl">
      ${sectionHead({ label: 'CPU + GPU', title: 'Put both processors<br><span class="text-gradient">to work.</span>', intro: 'WAMR3D prepares scene data in compiled Rust and sends a frame ready to draw through WebGPU or WebGL 2. No plug-in or separate install is needed; it runs in the browser.' })}
      <div class="grid gap-5 md:grid-cols-3">
        ${step('01 · CPU, in WebAssembly', 'Scene work in compiled Rust.', 'The Rust engine stores scene data in typed memory and handles transforms, culling and draw ordering. The object API keeps user-facing transforms in JavaScript and synchronizes them in batches.', ['Transforms and world matrices, only for what changed', 'Frustum culling and draw ordering', 'Lights, shadows and materials packed into one uniform buffer', 'Thousands of objects moved by one batched call'])}
        ${step('02 · The boundary', 'One crossing per frame.', 'The object API records your changes and sends them to the engine in a batch. Geometry and world matrices are typed-array views over engine memory: read without copying.', ['Zero-copy views of geometry and matrices', 'Vertex and index buffers uploaded only when they change', 'No per-property calls into WebAssembly'])}
        ${step('03 · GPU, WebGPU or WebGL 2', 'A frame that is ready to draw.', 'A thin host turns the prepared frame into GPU commands: pipelines and programs are cached, instanced meshes draw in one call, and the same frame runs on WebGPU or WebGL 2.', ['Cached pipelines, no per-frame rebuilds', 'Instancing, PCF shadows and physically based lighting', 'Automatic backend selection with WebGL 2 support'])}
      </div>
      <p class="mt-8 max-w-3xl text-sm leading-relaxed text-slate-400" data-reveal>The result: the CPU time three.js spends updating and submitting a scene shrinks, and more of each frame is left to the GPU. How much depends on the scene; the <a class="text-brand-cyan hover:text-white" href="#/benchmarks">benchmarks</a> show measured medians, including where WAMR3D is slower.</p>
    </div>
  </section>`;
}

function performance() {
  const sep = showcase[HEADLINE].objects[10000], inst = showcase[HEADLINE].instanced[50000];
  const res = HEADLINE.replace('x', '×');
  const mathSlowdown = lowLevel.filter(([name]) => /^(Matrix4|Vector3)\./.test(name)).map(([, three, wamr]) => wamr / three);
  const stat = (value, unit, label, detail) => `<div class="glass gradient-border rounded-3xl p-7" data-reveal>
    <p class="font-display text-5xl font-semibold tracking-tight text-white">${value}<span class="ml-1 text-2xl text-slate-400">${unit}</span></p>
    <p class="mt-3 font-semibold text-slate-200">${label}</p>
    <p class="mt-2 text-sm leading-relaxed text-slate-400">${detail}</p>
  </div>`;
  return `<section id="performance" class="relative px-6 py-20">
    <div class="mx-auto max-w-6xl">
      ${sectionHead({ label: 'Measured, not promised', title: 'Batch the work.<br><span class="text-gradient">See the difference.</span>', intro: `The same scene, ${engines.length} renderers, one engine at a time. Medians from a single run on one machine; higher is better in every figure here. Open the showcase to measure yours.` })}
      <div class="mb-8 grid gap-5 ${sep['batched-webgl'] ? 'md:grid-cols-2 lg:grid-cols-4' : 'md:grid-cols-3'}">
        ${stat(sep.batched.fps.toFixed(0), 'fps', `10,000 separate meshes at ${res}`, `WAMR3D batched. three.js ran at ${sep.webgl.fps.toFixed(1)} fps with WebGL and ${sep.webgpu.fps.toFixed(1)} fps with WebGPU.`)}
        ${stat(inst.batched.fps.toFixed(0), 'fps', `50,000 instanced bodies at ${res}`, `WAMR3D batched. three.js ran at ${inst.webgl.fps.toFixed(1)} fps with WebGL and ${inst.webgpu.fps.toFixed(1)} fps with WebGPU; its scene update took ${inst.webgl.update.toFixed(0)} to ${inst.webgpu.update.toFixed(0)} ms against ${inst.batched.update.toFixed(1)} ms.`)}
        ${stat((sep.webgl.submit / sep.batched.submit).toFixed(1), '× faster', 'Draw submission than three.js WebGL', `10,000 separate meshes at ${res}: ${sep.batched.submit.toFixed(1)} ms of CPU time per frame against ${sep.webgl.submit.toFixed(1)} ms. Computed from the measured medians.`)}
        ${sep['batched-webgl'] ? stat(sep['batched-webgl'].fps.toFixed(0), 'fps', `The same 10,000 meshes on WebGL 2`, `WAMR3D batched on its WebGL 2 renderer, for machines without WebGPU: ${(sep['batched-webgl'].fps / sep.webgl.fps).toFixed(1)}× the frame rate of three.js WebGL (${sep.webgl.fps.toFixed(1)} fps) on the same graphics API.`) : ''}
      </div>
      <div data-reveal>${showcaseChart('objects', 10000, HEADLINE)}</div>
      <div class="mt-8 grid grid-cols-1 gap-5 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <p class="text-sm leading-relaxed text-slate-400" data-reveal><strong class="text-slate-200">Where it is slower:</strong> the object API keeps vectors, matrices, quaternions and colours in plain JavaScript, but the low-level engine classes cross into WebAssembly on every call, which has a fixed cost. ${mathSlowdown.length ? `Single low-level math calls measured ${Math.min(...mathSlowdown).toFixed(1)}× to ${Math.max(...mathSlowdown).toFixed(1)}× slower than three.js.` : ''} GPU time is not measured; it only shows in the frame rate.</p>
        <p class="font-mono text-[11px] leading-relaxed text-slate-400 md:text-right" data-reveal>${meta.cpu}, ${meta.gpu.replace(/ \(0x.*$/, '')}, ${meta.chrome} headless, ${meta.os}.<br>Every chart comes from one run on ${meta.date}.${meta.dir ? ` Raw logs: <a class="text-brand-cyan hover:text-white" href="${repoFile(meta.dir)}" target="_blank" rel="noreferrer">${meta.dir}</a>.` : ''}</p>
      </div>
      <div class="mt-8" data-reveal>${button('#/benchmarks', 'All benchmark results', 'secondary')}</div>
    </div>
  </section>`;
}

function liveDemo() {
  const others = [
    ['#/examples', 'Engine demos', 'Explore the browser demo, visual parity cases and renderer comparisons.'],
    ['./examples/showcase/', 'Showcase', 'Up to 100,000 animated bodies. Switch between WAMR3D and three.js and compare live timings.'],
    ['./examples/compare/', 'Side by side', 'The same scene on each engine, with timing overlays.']
  ];
  return `<section id="demo" class="relative px-6 py-20">
    <div class="mx-auto max-w-6xl">
      ${sectionHead({ label: 'Live demos', title: 'Running in your browser.<br><span class="text-gradient">Right now.</span>', intro: 'Every demo below is drawn by WAMR3D, with WebGPU or WebGL 2 depending on your browser, except the three.js engines you choose to compare against.' })}
      <div class="grid grid-cols-1 gap-5 md:grid-cols-3">
        ${others.map(([href, title, body], i) => `<a href="${href}" target="_blank" rel="noreferrer" class="glass group flex flex-col justify-between rounded-3xl p-6 transition hover:-translate-y-0.5 hover:bg-white/[0.07]" data-reveal style="--reveal-delay:${i * 80}ms"><div><h3 class="flex items-center justify-between font-display text-lg font-semibold text-white">${title}<span class="text-slate-400 transition group-hover:text-brand-cyan">${icon('external')}</span></h3><p class="mt-2 text-sm leading-relaxed text-slate-400">${body}</p></div></a>`).join('')}
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
  return shell(`${hero()}<div class="relative bg-gradient-to-b from-transparent via-ink-950/80 to-ink-950">${migrationPreview()}${features()}${pipeline()}${performance()}${liveDemo()}${install()}${closing()}</div>`, 'home');
}
