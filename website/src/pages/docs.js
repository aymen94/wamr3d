import { button, codeBlock, icon, pageIntro, repoFile, shell } from '../components/ui.js';

const objectApi = `import * as WAMR3D from 'wamr3d/compat';
await WAMR3D.init();

const scene = new WAMR3D.Scene();
const camera = new WAMR3D.PerspectiveCamera( 50, innerWidth / innerHeight, 0.1, 100 );
const mesh = new WAMR3D.Mesh(
  new WAMR3D.BoxGeometry(),
  new WAMR3D.MeshStandardMaterial( { color: 0x7cfa9a, roughness: 0.4 } )
);
scene.add( mesh );

const renderer = new WAMR3D.WebGPURenderer( { antialias: true } );
await renderer.init();
renderer.render( scene, camera );`;

const lowLevel = `import { init, World } from 'wamr3d';

await init();

const world = new World();
const scene = world.createObject();
const arm = world.createObject();
const hand = world.createObject();
world.add( scene, arm );
world.add( arm, hand );

world.setPosition( arm, 10, 0, 0 );
world.setRotation( arm, 0, 0, Math.PI / 2, 'XYZ' );
world.setPosition( hand, 1, 0, 0 );

world.updateMatrixWorld( scene, false );
console.log( world.matrixWorld( hand ) ); // Float32Array(16), column-major`;

const fallback = `// 'auto' (the default): WebGPU, else WebGL 2, else a software WebGPU adapter
const renderer = new WAMR3D.WebGPURenderer( { antialias: true } );
await renderer.init();
console.log( renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL 2' );

// or choose: WebGPU only, or WebGL 2 only (forceWebGL: true is the same)
new WAMR3D.WebGPURenderer( { backend: 'webgpu' } );
new WAMR3D.WebGPURenderer( { backend: 'webgl' } );

// code written for three.js's WebGLRenderer keeps it: WAMR3D on WebGL 2
const legacy = new WAMR3D.WebGLRenderer( { antialias: true } );`;

const toc = [['object-api', 'Object API'], ['low-level', 'Low-level API'], ['conventions', 'Conventions'], ['no-webgpu', 'WebGPU or WebGL 2'], ['coverage', 'Coverage'], ['architecture', 'Architecture']];

const article = (id, label, title, body) => `<article id="${id}" class="scroll-mt-28 border-b border-white/5 py-14 first:pt-0 last:border-0" data-reveal>
  <p class="font-mono text-[11px] uppercase tracking-[0.2em] text-brand-cyan">${label}</p>
  <h2 class="mt-3 font-display text-3xl font-semibold tracking-tight text-white">${title}</h2>
  <div class="mt-5 space-y-5 leading-relaxed text-slate-400">${body}</div>
</article>`;

const coverage = (state, tone, items) => `<div class="glass rounded-2xl p-5"><p class="flex items-center gap-2 font-semibold ${tone}">${icon(state === 'Not included' ? 'cross' : 'check')}${state}</p><p class="mt-2 text-sm text-slate-400">${items}</p></div>`;

export function docs() {
  return shell(`${pageIntro({ label: 'Documentation', title: 'Start with what <span class="text-gradient">you already know.</span>', intro: 'Use the three.js-style object API for familiar code, or the handle-based low-level API to batch large scene updates. Both drive the same engine.' })}
  <div class="relative bg-gradient-to-b from-transparent via-ink-950/85 to-ink-950">
    <div class="mx-auto grid max-w-6xl grid-cols-1 gap-12 px-6 pb-24 lg:grid-cols-[14rem_minmax(0,1fr)]">
      <nav class="hidden lg:block" aria-label="On this page"><div class="sticky top-28 space-y-1 border-l border-white/10">${toc.map(([id, label]) => `<a href="#/docs#${id}" class="-ml-px block border-l border-transparent py-1.5 pl-4 text-sm text-slate-400 transition hover:border-brand-cyan hover:text-white">${label}</a>`).join('')}</div></nav>
      <div>
        ${article('object-api', '01 · The familiar route', 'Object API', `<p>Import from <code class="font-mono text-slate-200">wamr3d/compat</code>. Classes, properties, chaining and scene construction follow three.js conventions where supported.</p>${codeBlock(objectApi, { title: 'object-api.js' })}<p>Setting <code class="font-mono text-slate-200">position</code>, <code class="font-mono text-slate-200">rotation</code> and <code class="font-mono text-slate-200">scale</code> does not call into WebAssembly: the object API keeps them in JavaScript and sends every change to the engine in one batch per frame. Engine objects are released when their JavaScript object is collected; <code class="font-mono text-slate-200">dispose()</code> releases them at once.</p>`)}
        ${article('low-level', '02 · The batched route', 'Low-level API', `<p>Handle-based and batched; use it when thousands of objects change every frame.</p>${codeBlock(lowLevel, { title: 'low-level.js' })}<ul class="list-disc space-y-2 pl-5 marker:text-brand-cyan"><li>Objects, geometries and materials are handles (<code class="font-mono text-slate-200">bigint</code>). Math values, <code class="font-mono text-slate-200">Timer</code> and <code class="font-mono text-slate-200">World</code> are classes; call <code class="font-mono text-slate-200">.free()</code> when done.</li><li>Methods change values in place and return nothing, so calls do not chain.</li><li>There are no default arguments: rotation order, segment counts and the like are always written out.</li><li>A view from <code class="font-mono text-slate-200">attributeView()</code> stops working when the module's memory grows. Create it right before use.</li><li><strong class="text-slate-200">Mix JavaScript and WebAssembly.</strong> Each call on the low-level math classes crosses into WebAssembly, which costs more than a small vector operation. For per-value math, import <code class="font-mono text-slate-200">Vector3</code>, <code class="font-mono text-slate-200">Quaternion</code>, <code class="font-mono text-slate-200">Matrix4</code> and the rest from <code class="font-mono text-slate-200">wamr3d/math</code>: JavaScript values that need no <code class="font-mono text-slate-200">init()</code> and chain as in three.js. Write the results into a <code class="font-mono text-slate-200">Float32Array</code> and send them in one call such as <code class="font-mono text-slate-200">world.setTransforms</code>. Measured results are on the <a class="text-brand-cyan hover:text-white" href="#/benchmarks">benchmarks</a> page.</li></ul>`)}
        ${article('conventions', '03 · Same as three.js', 'Conventions', `<ul class="list-disc space-y-2 pl-5 marker:text-brand-cyan"><li>Right-handed, +Y up, cameras look down −Z, column-major matrices, radians.</li><li>Math values in the object API are 64-bit JavaScript numbers; the engine stores transforms and geometry as 32-bit floats, and results agree with three.js to about <code class="font-mono text-slate-200">1e-6</code>. Keep animated angles wrapped rather than letting them grow for minutes.</li><li><code class="font-mono text-slate-200">world.destroy(object)</code> leaves the children alive as roots; <code class="font-mono text-slate-200">destroyRecursive</code> removes the subtree.</li></ul>`)}
        ${article('no-webgpu', '04 · Backends', 'WebGPU or WebGL 2', `<p>WAMR3D draws with WebGPU where the browser has it and switches to its own WebGL 2 renderer otherwise, so it also runs on machines without WebGPU or a recent graphics driver. The scene work in WebAssembly is the same on both; only the final drawing calls differ. You can also pick the backend yourself:</p>${codeBlock(fallback, { title: 'backend.js' })}<p>On WebGL 2, colour is blended in sRGB space as three.js's WebGL renderer does, render targets are single-sampled, and tone mapping, float render targets and environment maps need the <code class="font-mono text-slate-200">EXT_color_buffer_float</code> extension.</p>`)}
        ${article('coverage', '05 · Current scope', 'What works and what is missing', `<p>WAMR3D covers three.js's scene graph, geometries, built-in materials, lights, shadows, textures, render targets, animation, loaders and the common add-ons. This page describes release <code class="font-mono text-slate-200">0.9.4</code>; check the migration notes before switching an application.</p><div class="grid gap-4 sm:grid-cols-2">${coverage('Included', 'text-emerald-300', 'Skinned meshes (culled using posed bounds), morph targets, every built-in material including matcap, depth, distance, shadow and dashed lines, per-material depth, stencil and polygon-offset state, clipping planes, area lights and light probes, basic, PCF and VSM shadows, environment maps, post-processing, GLTFLoader and the other loaders, TransformControls and ArcballControls.')}${coverage('Not included', 'text-amber-300', 'TSL node materials and node post-processing (not ported), GLSL shader materials on WebGPU, and shadows inside shader materials.')}</div>${button(repoFile('STATUS.md'), 'Full implementation status', 'secondary', true)} ${button('#/migration', 'Migration notes', 'secondary')}`)}
        ${article('architecture', '06 · Under the hood', 'Typed core, thin host', `<p>A Rust engine compiled to WebAssembly prepares each frame: culling, ordering, pipeline state, uniform data and WGSL. A thin JavaScript host issues the WebGPU calls. The low-level API exposes geometry and world matrices through typed-array views over engine memory; compatibility API properties may return copies.</p><p>Math, scene graph and API behaviour are compared with fixtures generated from the three.js source; the renderer is compared with stored three.js images.</p>`)}
      </div>
    </div>
  </div>`, 'docs');
}
