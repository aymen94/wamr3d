import { home } from './home.js';
import { docs } from './docs.js';
import { benchmarks } from './benchmarks.js';
import { examples } from './examples.js';
import { migration } from './migration.js';

export const routes = {
  '/': { render: home, title: 'WAMR3D | Fast WebAssembly + WebGPU 3D engine with a three.js-style API', description: 'WAMR3D is a fast WebAssembly 3D engine with a Rust core, its own WebGPU renderer and a three.js-style API. Up to 2.8× faster scene updates than three.js. Open source, MIT.' },
  '/docs': { render: docs, title: 'Documentation | WAMR3D', description: 'Use the three.js-style object API or the batched low-level API of WAMR3D, a WebAssembly 3D engine with a WebGPU renderer.' },
  '/benchmarks': { render: benchmarks, title: 'Benchmarks | WAMR3D', description: 'Measured comparisons of WAMR3D and three.js: frame rate, scene update and draw submission, with method and limits.' },
  '/examples': { render: examples, title: 'Live demos | WAMR3D', description: 'WAMR3D demos: three.js games and scenes ported by changing the import (Crossy Road, Stack, City 3D, a voxel world, official examples), the 100,000-body showcase, the three.js comparison and visual parity.' },
  '/migration': { render: migration, title: 'Migrate from three.js | WAMR3D', description: 'Migrate from three.js to WAMR3D: change the import, switch to the WebGPU renderer and batch the hot paths. Class-by-class mapping included.' }
};
