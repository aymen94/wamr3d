import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const websiteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = path.resolve(websiteRoot, '..');
const outputRoot = path.join(websiteRoot, 'dist');
const copy = async (from, to) => {
  const source = path.join(projectRoot, from);
  const destination = path.join(outputRoot, to);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(source, destination);
};

const wasmPackage = path.join(projectRoot, 'dist', 'wamr3d');
try {
  await fs.access(path.join(wasmPackage, 'wamr3d_wasm_bg.wasm'));
} catch (error) {
  throw new Error('Wasm package not found. Build it first with `node engine/bindings/build.mjs`.', { cause: error });
}

for (const asset of ['favicon.ico', 'favicon-16x16.png', 'favicon-32x32.png', 'apple-touch-icon.png', 'android-chrome-192x192.png', 'android-chrome-512x512.png', 'logo.png', 'site.webmanifest']) await copy(asset, asset);
for (const document of ['README.md', 'MIGRATION.md', 'STATUS.md', 'DECISIONS.md', 'THIRD_PARTY.md']) await copy(document, `project-docs/${document}`);
await fs.cp(path.join(projectRoot, 'examples', 'webgpu'), path.join(outputRoot, 'examples', 'webgpu'), { recursive: true });
await fs.cp(path.join(projectRoot, 'examples', 'showcase'), path.join(outputRoot, 'examples', 'showcase'), { recursive: true });
await fs.cp(path.join(projectRoot, 'examples', 'compare'), path.join(outputRoot, 'examples', 'compare'), { recursive: true });
await copy('examples/three-reference.js', 'examples/three-reference.js');
await fs.cp(path.join(projectRoot, 'parity', 'visual'), path.join(outputRoot, 'parity', 'visual'), { recursive: true });
await fs.cp(wasmPackage, path.join(outputRoot, 'dist', 'wamr3d'), { recursive: true });
await fs.writeFile(path.join(outputRoot, '.nojekyll'), '');
console.log('Prepared Pages output: docs, standalone renderer demo, showcase, comparison, and visual parity fixtures.');
