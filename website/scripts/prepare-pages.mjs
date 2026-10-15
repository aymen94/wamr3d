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
const copyWebsiteAsset = async (from, to) => {
  const source = path.join(websiteRoot, from);
  const destination = path.join(outputRoot, to);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(source, destination);
};

// The site ships the local build, the same package its pages and examples are developed against.
const wasmPackage = path.join(projectRoot, 'dist', 'wamr3d');
try {
  await fs.access(path.join(wasmPackage, 'wamr3d_wasm_bg.wasm'));
} catch (error) {
  throw new Error('The local wamr3d package is missing. Run `node engine/bindings/build.mjs` at the repository root first.', { cause: error });
}

await copyWebsiteAsset('images/favicon.ico', 'images/favicon.ico');
await fs.cp(path.join(websiteRoot, 'images', 'examples'), path.join(outputRoot, 'images', 'examples'), { recursive: true });
// Site icons live in website/images/ (older checkouts keep them at the repository root);
// the pages expect them at the site root.
for (const asset of ['favicon.ico', 'favicon-16x16.png', 'favicon-32x32.png', 'apple-touch-icon.png', 'android-chrome-192x192.png', 'android-chrome-512x512.png', 'logo.png', 'site.webmanifest']) {
  const moved = path.join('images', asset);
  try {
    await fs.access(path.join(websiteRoot, moved));
    await copyWebsiteAsset(moved, asset);
  } catch {
    await copy(asset, asset);
  }
}
for (const document of ['README.md', 'MIGRATION.md', 'STATUS.md', 'DECISIONS.md']) await copy(document, `project-docs/${document}`);
await fs.cp(path.join(projectRoot, 'examples'), path.join(outputRoot, 'examples'), { recursive: true });
await fs.cp(path.join(projectRoot, 'parity', 'visual'), path.join(outputRoot, 'parity', 'visual'), { recursive: true, filter: (source) => path.basename(source) !== 'out' });
await fs.cp(wasmPackage, path.join(outputRoot, 'dist', 'wamr3d'), { recursive: true });
await fs.writeFile(path.join(outputRoot, '.nojekyll'), '');
const site = 'https://aymen94.github.io/wamr3d/';
await fs.writeFile(path.join(outputRoot, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${site}sitemap.xml\n`);
await fs.writeFile(path.join(outputRoot, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${site}</loc></url></urlset>\n`);
console.log('Prepared Pages output: docs, ported games and scenes, showcase, comparison, and visual parity fixtures.');
