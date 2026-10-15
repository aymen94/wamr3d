// The optional three.js reference for the comparison pages, pinned to one release and
// loaded from a CDN. WAMR3D itself never imports this file: only the comparison engines, the
// reference adapter and the reference checks do, and only when they are selected.
//
// Both entry points import `./three.core.js` next to them, so they share one core.
// (`three.tsl.js` in the same folder is not standalone: it imports `three/webgpu` by
// name and needs an import map. Nothing here uses it.)

export const THREE_VERSION = '0.186.1';
const BASE = `https://cdnjs.cloudflare.com/ajax/libs/three.js/${THREE_VERSION}/`;

/** Core classes and the WebGL renderer. */
export const THREE_WEBGL_URL = BASE + 'three.module.js';
/** Core classes and the WebGPU renderer. */
export const THREE_WEBGPU_URL = BASE + 'three.webgpu.js';

export const loadThreeWebGL = () => import( /* @vite-ignore */ THREE_WEBGL_URL );
export const loadThreeWebGPU = () => import( /* @vite-ignore */ THREE_WEBGPU_URL );
