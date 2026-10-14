import { button, codeBlock, pageIntro, repoFile, sectionHead, shell } from '../components/ui.js';

const diff = `- import * as THREE from 'three';
+ import * as THREE from 'wamr3d/compat';
+ await THREE.init();

- const renderer = new THREE.WebGLRenderer( { antialias: true } );
+ const renderer = new THREE.WebGPURenderer( { antialias: true } );
+ await renderer.init();`;

const differences = [
  ['Works without setup', '<code>await init()</code> once, and <code>await renderer.init()</code> before the first <code>render</code> (<code>setAnimationLoop</code> waits for you)'],
  ['<code>WebGLRenderer</code>', '<code>WebGPURenderer</code> only'],
  ['<code>MeshStandardMaterial</code> with environment and many maps', '<code>color</code>, <code>map</code>, <code>roughness</code>, <code>metalness</code>, <code>side</code>, <code>transparent</code>, <code>opacity</code>, <code>depthTest</code>, <code>depthWrite</code>, <code>vertexColors</code>. Unsupported parameters are stored, have no effect and log one warning'],
  ['A missing class is <code>undefined</code>', 'Unsupported classes (<code>LineLoop</code>, <code>SkinnedMesh</code>, <code>LOD</code>, <code>MeshPhongMaterial</code>, <code>WebGLRenderer</code>, …) throw “not available yet”'],
  ['Any number of lights', 'Up to 16 directional, point and spot lights combined, plus ambient and hemisphere lights. Directional and spot lights support PCF shadows; point-light shadows are not available'],
  ['Shadows from any light', 'Directional and spot shadows support PCF filtering, up to 4 shadow-casting lights per frame. Other shadow-map types draw as PCF. Point lights cast no shadows'],
  ['Points, sprites, render targets and tone mapping', 'Supported, with limitations: points are one pixel, sprites are not raycast, and screen tone mapping applies to the whole frame'],
  ['<code>object.matrix.elements[ 12 ] = 5</code>', '<code>matrixWorld</code>, <code>matrix.elements</code>, <code>box.min</code> and similar are copies. Use <code>position</code>, <code>rotation</code>, <code>scale</code> or the value’s methods'],
  ['Numbers are 64-bit', 'Stored as 32-bit floats; results agree to about <code>1e-6</code>'],
  ['Garbage collected', 'Also here; <code>dispose()</code> releases engine objects at once']
];

const missing = [
  ['Rendering', 'Environment reflections are partly built but not usable; maps other than <code>map</code>; more than 16 lights; area lights; point-light shadows; shadow modes other than PCF; scene background textures; post-processing; render-target depth textures and multiple attachments; lines wider than one pixel; a WebGL fallback.'],
  ['Objects and materials', '<code>LineLoop</code>, <code>SkinnedMesh</code>, <code>LOD</code>, <code>MeshPhongMaterial</code>, <code>MeshPhysicalMaterial</code>, <code>MeshToonMaterial</code>, <code>MeshNormalMaterial</code>, <code>ShaderMaterial</code>; picking sprites or individual instances of an <code>InstancedMesh</code>.'],
  ['Everything else', 'Loaders other than <code>TextureLoader</code>, the animation system, audio, controls, and helpers other than <code>GridHelper</code> and <code>AxesHelper</code>.']
];

const steps = [
  ['Install and change the import', 'Install <code>wamr3d</code> from npm, import <code>wamr3d/compat</code> where you imported <code>three</code>, and initialise the module once.'],
  ['Swap the renderer', 'Create a <code>WebGPURenderer</code> and await <code>renderer.init()</code>. Your scene, camera, meshes and animation loop stay as they are for supported classes.'],
  ['Check what you depend on', 'Compare your imports with the list below. Unsupported constructors throw, so a missing feature shows up on the first run.'],
  ['Batch the hot paths', 'When a scene grows to thousands of moving objects, move the per-frame updates to the batched low-level API and measure.']
];

export function migration() {
  const code = (html) => html.replaceAll('<code>', '<code class="font-mono text-[0.92em] text-slate-200">');
  return shell(`${pageIntro({ label: 'Migration from three.js', title: 'A familiar API.<br><span class="text-gradient">A focused switch.</span>', intro: 'Start with the supported object classes. Move to the batched API when the size of your scene makes it worthwhile.' })}
  <div class="relative bg-gradient-to-b from-transparent via-ink-950/85 to-ink-950">
    <section class="mx-auto grid max-w-6xl grid-cols-1 items-start gap-12 px-6 pb-24 lg:grid-cols-2">
      <ol class="space-y-4">${steps.map(([title, body], i) => `<li class="glass flex gap-5 rounded-3xl p-6" data-reveal style="--reveal-delay:${i * 70}ms"><span class="font-display text-3xl font-semibold text-gradient">0${i + 1}</span><div><h2 class="font-semibold text-white">${title}</h2><p class="mt-1.5 text-sm leading-relaxed text-slate-400">${code(body)}</p></div></li>`).join('')}</ol>
      <div class="space-y-5 lg:sticky lg:top-28" data-reveal>${codeBlock(diff, { title: 'app.js', diff: true })}<p class="text-sm leading-relaxed text-slate-400">${code('<code>scene.add( mesh )</code>, <code>mesh.position.set( 1, 2, 3 )</code>, <code>mesh.rotation.y += 0.01</code>, <code>camera.lookAt( 0, 0, 0 )</code>, <code>raycaster.intersectObjects( scene.children )</code> and chained math keep working as written.')}</p></div>
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
