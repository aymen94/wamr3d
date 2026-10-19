import { button, codeBlock, pageIntro, repoFile, sectionHead, shell } from '../components/ui.js';

const diff = `- import * as THREE from 'three';
+ import * as THREE from 'wamr3d/compat';
+ await THREE.init();

- const renderer = new THREE.WebGLRenderer( { antialias: true } );
+ const renderer = new THREE.WebGPURenderer( { antialias: true } );
+ await renderer.init();`;

const differences = [
  ['Works without setup', '<code>await init()</code> once, and <code>await renderer.init()</code> before the first <code>render</code> (<code>setAnimationLoop</code> waits for you)'],
  ['<code>WebGLRenderer</code>', 'Works: the same renderer drawing with WebGL 2. <code>WebGPURenderer</code> picks WebGPU or WebGL 2 by itself'],
  ['<code>WebGPURenderer</code> falls back to WebGL 2', 'The same here, with WAMR3D\'s own WebGL 2 renderer; <code>backend: \'webgpu\'</code> or <code>\'webgl\'</code> (or <code>forceWebGL</code>) pins one. <a class="text-brand-cyan hover:text-white" href="#/docs#no-webgpu">Backends</a>'],
  ['Built-in materials', 'Basic, Lambert, Phong, toon, normal, standard and physical (clearcoat, sheen, iridescence, anisotropy, transmission), with 24 kinds of map; matcap, depth, distance, shadow and dashed-line materials; per-material stencil, depth function and polygon offset; clipping planes'],
  ['<code>ShaderMaterial</code>', 'GLSL draws on WebGL 2; on WebGPU it draws unlit, as three.js\'s WebGPURenderer takes no GLSL, with <code>lights</code> and <code>fog</code> but no shadows'],
  ['Node materials (TSL)', 'Not ported: use the built-in materials'],
  ['Any number of lights', 'Up to 16 directional, point, spot and rectangular area lights, plus ambient and hemisphere lights and light probes'],
  ['Shadows from any light', 'Directional, spot and point lights; basic, PCF and VSM filtering (<code>PCFSoftShadowMap</code> draws as PCF, as in three.js\'s <code>WebGPURenderer</code>)'],
  ['<code>three/addons/...</code>', '<code>wamr3d/addons/...</code>: controls (including <code>TransformControls</code> and <code>ArcballControls</code>), <code>GLTFLoader</code> with Draco, KTX2 and meshopt, FBX, OBJ/MTL, RGBE/HDR and EXR loaders, post-processing and wide lines'],
  ['<code>object.matrix.elements[ 12 ] = 5</code>', 'Takes effect with <code>matrixAutoUpdate = false</code>, as in three.js; <code>matrixWorld</code> is read from the engine and overwritten on the next update'],
  ['Numbers are 64-bit', 'Transforms and geometry are stored as 32-bit floats; results agree to about <code>1e-6</code>'],
  ['Garbage collected', 'Also here; <code>dispose()</code> releases engine objects at once']
];

const missing = [
  ['Node-based rendering', 'TSL node materials and node post-processing are out of scope: WAMR3D draws with its own WGSL and GLSL shaders.'],
  ['GLSL on WebGPU', '<code>ShaderMaterial</code> needs the WebGL 2 backend, and gets no shadow maps there.'],
  ['Small gaps', '<code>LineMaterial.dashOffset</code>, <code>wireframeLinewidth</code> above 1, <code>CustomToneMapping</code> and offset or rotation of background textures have no effect and warn once.'],
  ['Browsers', 'Tested in Chromium-based browsers; Firefox and Safari have not been tried yet.']
];

const steps = [
  ['Install and change the import', 'Install <code>wamr3d</code> from npm, import <code>wamr3d/compat</code> where you imported <code>three</code>, and initialise the module once.'],
  ['Swap the renderer', 'Create a <code>WebGPURenderer</code> (or keep <code>WebGLRenderer</code>) and await <code>renderer.init()</code>. Your scene, camera, meshes and animation loop stay as they are for supported classes; browsers without WebGPU get WebGL 2 automatically.'],
  ['Check what you depend on', 'Compare your imports with the list below. Unsupported parameters are stored, have no effect and log one warning, so the first run lists what your scene depends on.'],
  ['Batch the hot paths', 'When a scene grows to thousands of moving objects, move the per-frame updates to the batched low-level API and measure.']
];

const choices = [
  ['Familiar object API', '<code>wamr3d/compat</code>', 'Best for existing three.js projects and typical scenes. Keep familiar classes, properties and scene-building patterns while WAMR3D batches object updates into the engine once per frame.', "import * as WAMR3D from 'wamr3d/compat';"],
  ['Batched low-level API', '<code>wamr3d</code> + <code>wamr3d/math</code>', 'Best when many objects change every frame or you need direct control. Generational handles and batched calls reduce JavaScript overhead; expect a more explicit, less three.js-like API. Do per-value math with the JavaScript values of <code>wamr3d/math</code> and send the results in one batched call.', "import { init, World } from 'wamr3d';\nimport { Vector3, Quaternion } from 'wamr3d/math';"],
  ['WebGPU or WebGL 2', '<code>WebGPURenderer</code>', 'Choose automatic selection for the broadest reach: WebGPU when available, WebGL 2 otherwise. Pin WebGPU for a WebGPU-only product, or WebGL 2 to target a known backend.', "new WAMR3D.WebGPURenderer({ backend: 'auto' });"]
];

export function migration() {
  const code = (html) => html.replaceAll('<code>', '<code class="font-mono text-[0.92em] text-slate-200">');
  return shell(`${pageIntro({ label: 'Migration from three.js', title: 'A familiar API.<br><span class="text-gradient">A focused switch.</span>', intro: 'Start with the supported object classes. Move to the batched API when the size of your scene makes it worthwhile.' })}
  <div class="relative bg-gradient-to-b from-transparent via-ink-950/85 to-ink-950">
    <section class="mx-auto grid max-w-6xl grid-cols-1 items-start gap-12 px-6 pb-24 lg:grid-cols-2">
      <ol class="space-y-4">${steps.map(([title, body], i) => `<li class="glass flex gap-5 rounded-3xl p-6" data-reveal style="--reveal-delay:${i * 70}ms"><span class="font-display text-3xl font-semibold text-gradient">0${i + 1}</span><div><h2 class="font-semibold text-white">${title}</h2><p class="mt-1.5 text-sm leading-relaxed text-slate-400">${code(body)}</p></div></li>`).join('')}</ol>
      <div class="space-y-5 lg:sticky lg:top-28" data-reveal>${codeBlock(diff, { title: 'app.js', diff: true })}<div class="glass rounded-2xl p-5"><p class="text-xs font-semibold uppercase tracking-wider text-brand-cyan">Keep your scene code</p><p class="mt-2 text-sm leading-relaxed text-slate-300">These familiar calls continue to work for supported classes:</p><ul class="mt-3 grid gap-2 sm:grid-cols-2">${['scene.add( mesh )', 'mesh.position.set( 1, 2, 3 )', 'mesh.rotation.y += 0.01', 'camera.lookAt( 0, 0, 0 )', 'raycaster.intersectObjects( scene.children )', 'chained math expressions'].map((item) => `<li class="rounded-lg border border-white/5 bg-black/20 px-3 py-2 font-mono text-xs text-slate-300">${item}</li>`).join('')}</ul></div><a href="#/migration#migration-choices" class="group flex items-center justify-between rounded-2xl border border-brand-cyan/20 bg-brand-cyan/5 px-5 py-4 text-sm text-slate-300 transition hover:border-brand-cyan/50 hover:text-white"><span><span class="block font-semibold text-white">Choose the setup that fits your project</span><span class="mt-1 block text-xs text-slate-400">Scroll down to compare the object API, batched API and rendering backends.</span></span><span aria-hidden="true" class="text-lg text-brand-cyan transition group-hover:translate-y-1">↓</span></a></div>
    </section>
    <section id="migration-choices" class="mx-auto max-w-6xl scroll-mt-24 px-6 pb-16">
      ${sectionHead({ label: 'Choose your setup', title: 'One engine, two ways to build', intro: 'Start with the API and rendering backend that fit your project. You can move from the familiar route to batched calls later, without changing the engine.' })}
      <div class="grid grid-cols-1 gap-4 md:grid-cols-3">${choices.map(([title, api, body, sample], i) => `<article class="glass min-w-0 rounded-3xl p-6" data-reveal style="--reveal-delay:${i * 70}ms"><p class="font-mono text-[11px] uppercase tracking-wider text-brand-cyan">Option 0${i + 1}</p><h2 class="mt-3 font-display text-xl font-semibold text-white">${title}</h2><p class="mt-1 font-mono text-xs text-slate-400">${code(api)}</p><p class="mt-4 text-sm leading-relaxed text-slate-400">${code(body)}</p>${codeBlock(sample, { title: 'app.js', className: 'mt-5' })}</article>`).join('')}</div>
    </section>
    <section class="mx-auto max-w-6xl px-6 py-24">
      ${sectionHead({ label: 'Differences', title: 'What to watch for' })}
      <div class="glass relative overflow-x-auto rounded-3xl p-2 sm:p-4" data-reveal><table class="w-full min-w-[36rem] text-left text-sm"><thead class="font-mono text-[11px] uppercase tracking-wider text-slate-400"><tr><th class="w-2/5 py-3 pl-3 pr-4 font-medium">In three.js</th><th class="py-3 pr-4 font-medium">In wamr3d/compat</th></tr></thead><tbody>${differences.map(([a, b]) => `<tr class="border-t border-white/5 align-top"><td class="py-3 pl-3 pr-4 text-slate-300">${code(a)}</td><td class="py-3 pr-4 text-slate-400">${code(b)}</td></tr>`).join('')}</tbody></table></div>
    </section>
    <section class="mx-auto max-w-6xl px-6 py-24">
      ${sectionHead({ label: 'Not available', title: 'Keep three.js for these', intro: 'If your application depends on any of these features, keep that part outside WAMR3D.' })}
      <div class="grid gap-4 sm:grid-cols-2">${missing.map(([title, body]) => `<div class="glass rounded-3xl p-6" data-reveal><h3 class="font-semibold text-white">${title}</h3><p class="mt-2 text-sm leading-relaxed text-slate-400">${code(body)}</p></div>`).join('')}</div>
      <div class="mt-10 flex flex-wrap gap-3" data-reveal>${button(`${repoFile('README.md')}#coming-from-threejs`, 'Full migration notes', 'primary', true)}${button('#/benchmarks', 'Review the benchmarks', 'secondary')}</div>
    </section>
  </div>`, 'migration');
}
