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
  ['<code>MeshStandardMaterial</code> with environment and many maps', '<code>color</code>, <code>map</code>, <code>roughness</code>, <code>metalness</code>, <code>emissive</code>, the normal, roughness, metalness, emissive, alpha and ambient-occlusion maps (one shared uv transform), <code>alphaTest</code>, <code>envMap</code> or <code>scene.environment</code> (equirectangular, one per frame), <code>side</code>, <code>transparent</code>, <code>opacity</code>, <code>depthTest</code>, <code>depthWrite</code>, <code>vertexColors</code>. Unsupported parameters are stored, have no effect and log one warning'],
  ['<code>MeshPhysicalMaterial</code>', 'Clearcoat, sheen, the specular layer, iridescence, anisotropy and transmission with dispersion, with every layer\'s maps'],
  ['<code>ShaderMaterial</code>', 'GLSL draws on WebGL 2; on WebGPU it draws unlit, as three.js\'s <code>WebGPURenderer</code> takes no GLSL'],
  ['Any number of lights', 'Up to 16 directional, point, spot and rectangular area lights combined, plus ambient, hemisphere lights and light probes'],
  ['Shadows from any light', 'Directional, spot and point lights; basic, PCF or VSM filtering (<code>PCFSoftShadowMap</code> draws as PCF, as in three.js\'s <code>WebGPURenderer</code>); up to 16 shadow maps per frame'],
  ['Points, sprites, render targets and tone mapping', 'Supported: points and lines above one pixel are drawn as quads, render targets take depth textures, picking a sprite needs <code>raycaster.camera</code> as in three.js'],
  ['<code>object.matrix.elements[ 12 ] = 5</code>', '<code>matrixWorld</code>, <code>matrix.elements</code>, <code>box.min</code> and similar are copies. Use <code>position</code>, <code>rotation</code>, <code>scale</code> or the value’s methods'],
  ['Numbers are 64-bit', 'Stored as 32-bit floats; results agree to about <code>1e-6</code>'],
  ['Garbage collected', 'Also here; <code>dispose()</code> releases engine objects at once']
];

const missing = [
  ['Loaders', 'GLTFLoader and other format loaders (FBX, OBJ, RGBE, EXR, KTX2, Draco). <code>ObjectLoader</code> reads three.js\'s JSON.'],
  ['Shaders', 'Node-based (TSL) materials and post-processing; lights, fog and shadows inside <code>ShaderMaterial</code>.'],
  ['Add-ons', '<code>TransformControls</code> and <code>ArcballControls</code>. Controls, post-processing passes and wide lines are in <code>wamr3d/addons/</code> (from 0.7.0).']
];

const steps = [
  ['Install and change the import', 'Install <code>wamr3d</code> from npm, import <code>wamr3d/compat</code> where you imported <code>three</code>, and initialise the module once.'],
  ['Swap the renderer', 'Create a <code>WebGPURenderer</code> (or keep <code>WebGLRenderer</code>) and await <code>renderer.init()</code>. Your scene, camera, meshes and animation loop stay as they are for supported classes; browsers without WebGPU get WebGL 2 automatically.'],
  ['Check what you depend on', 'Compare your imports with the list below. Unsupported constructors throw, so a missing feature shows up on the first run.'],
  ['Batch the hot paths', 'When a scene grows to thousands of moving objects, move the per-frame updates to the batched low-level API and measure.']
];

const choices = [
  ['Familiar object API', '<code>wamr3d/compat</code>', 'Best for existing three.js projects and typical scenes. Keep familiar classes, properties and scene-building patterns while WAMR3D batches object updates into the engine once per frame.', "import * as WAMR3D from 'wamr3d/compat';"],
  ['Batched low-level API', '<code>wamr3d</code>', 'Best when many objects change every frame or you need direct control. Generational handles and batched calls reduce JavaScript overhead; expect a more explicit, less three.js-like API.', "import { init, World } from 'wamr3d';"],
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
      <div class="grid gap-4 md:grid-cols-3">${choices.map(([title, api, body, sample], i) => `<article class="glass rounded-3xl p-6" data-reveal style="--reveal-delay:${i * 70}ms"><p class="font-mono text-[11px] uppercase tracking-wider text-brand-cyan">Option 0${i + 1}</p><h2 class="mt-3 font-display text-xl font-semibold text-white">${title}</h2><p class="mt-1 font-mono text-xs text-slate-400">${code(api)}</p><p class="mt-4 text-sm leading-relaxed text-slate-400">${code(body)}</p>${codeBlock(sample, { title: 'app.js', className: 'mt-5' })}</article>`).join('')}</div>
    </section>
    <section class="mx-auto max-w-6xl px-6 py-24">
      ${sectionHead({ label: 'Differences', title: 'What to watch for' })}
      <div class="glass relative overflow-x-auto rounded-3xl p-2 sm:p-4" data-reveal><table class="w-full min-w-[36rem] text-left text-sm"><thead class="font-mono text-[11px] uppercase tracking-wider text-slate-400"><tr><th class="w-2/5 py-3 pl-3 pr-4 font-medium">In three.js</th><th class="py-3 pr-4 font-medium">In wamr3d/compat</th></tr></thead><tbody>${differences.map(([a, b]) => `<tr class="border-t border-white/5 align-top"><td class="py-3 pl-3 pr-4 text-slate-300">${code(a)}</td><td class="py-3 pr-4 text-slate-400">${code(b)}</td></tr>`).join('')}</tbody></table></div>
    </section>
    <section class="mx-auto max-w-6xl px-6 py-24">
      ${sectionHead({ label: 'Not available yet', title: 'Keep three.js for these', intro: 'If your application depends on any of them, keep that part outside WAMR3D or wait for it to land.' })}
      <div class="grid gap-4 sm:grid-cols-2">${missing.map(([title, body]) => `<div class="glass rounded-3xl p-6" data-reveal><h3 class="font-semibold text-white">${title}</h3><p class="mt-2 text-sm leading-relaxed text-slate-400">${code(body)}</p></div>`).join('')}</div>
      <div class="mt-10 flex flex-wrap gap-3" data-reveal>${button(repoFile('MIGRATION.md'), 'Full migration guide', 'primary', true)}${button('#/benchmarks', 'Review the benchmarks', 'secondary')}</div>
    </section>
  </div>`, 'migration');
}
