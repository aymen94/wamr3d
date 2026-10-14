import { home } from './home.js';
import { docs } from './docs.js';
import { benchmarks } from './benchmarks.js';
import { examples } from './examples.js';
import { migration } from './migration.js';

export const routes = {
  '/': { render: home, title: 'WAMR3D | WebAssembly 3D rendering engine with a three.js-style API', description: 'WAMR3D is a WebAssembly 3D rendering engine with a Rust core and its own WebGPU renderer. Its object API follows three.js, so migrating supported code starts with one import.' },
  '/docs': { render: docs, title: 'Documentation | WAMR3D', description: 'Use the three.js-style object API or the batched low-level API of WAMR3D, a WebAssembly 3D engine with a WebGPU renderer.' },
  '/benchmarks': { render: benchmarks, title: 'Benchmarks | WAMR3D', description: 'Measured comparisons of WAMR3D and three.js: frame rate, scene update and draw submission, with method and limits.' },
  '/examples': { render: examples, title: 'Live demos | WAMR3D', description: 'WebGPU demos of WAMR3D: renderer demo, 100,000-body showcase, three.js comparison and visual parity.' },
  '/migration': { render: migration, title: 'Migrate from three.js | WAMR3D', description: 'Move supported three.js code to WAMR3D: change the import, use the WebGPU renderer, and check what is not available yet.' }
};
