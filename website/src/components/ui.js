// Markup helpers. Everything here returns strings and touches no DOM, so pages can also be
// rendered at build time for search engines (vite.config.js).

export const REPO = 'https://github.com/aymen94/wamr3d';
export const NPM = 'https://www.npmjs.com/package/wamr3d';
export const repoFile = (path) => `${REPO}/blob/main/${path}`;

const escape = (text) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

// The background's brand cube in miniature: a dark core inside a cyan frame and a violet frame.
// Clicking it breaks it into 8 mini cubes that fly out and rebuild it (CSS: mini-cube rules).
const cubeFaces = '<i></i>'.repeat(6);

// 2×2×2 pieces: slot at ±5px on each axis, a scattered target that drops toward the bottom
// (+y is down in CSS), and a different spin per piece.
const cubePieces = Array.from({ length: 8 }, (_, i) => {
  const x = i & 1 ? 1 : -1, y = i & 2 ? 1 : -1, z = i & 4 ? 1 : -1;
  const vars = [
    `--sx:${x * 5}px`, `--sy:${y * 5}px`, `--sz:${z * 5}px`,
    `--tx:${x * 15}px`, `--ty:${y * 7 + 9}px`, `--tz:${z * 15}px`,
    `--ax:${(i % 3) / 2}`, `--ay:${i % 2 ? 1 : 0.4}`, `--r:${(i % 2 ? 1 : -1) * (200 + i * 30)}deg`,
  ].join(';');
  return `<span class="mini-cube-box is-piece" style="${vars}">${cubeFaces}</span>`;
}).join('');

export const miniCube = `<span class="mini-cube" aria-hidden="true"><span class="mini-cube-spin"><span class="mini-cube-box is-frame">${cubeFaces}</span><span class="mini-cube-box is-edge">${cubeFaces}</span><span class="mini-cube-box is-core">${cubeFaces}</span>${cubePieces}</span></span>`;

// Plays the break on every mini cube, including ones rendered later. Call once from main.js
// (this is the only helper here that touches the DOM, and only when called).
export function wireMiniCubes(root = document) {
  // A click on the cube plays the animation instead of following the wordmark's home link
  // (navigating re-renders the header and would cut it off); the text still links home.
  root.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('.mini-cube')) event.preventDefault();
  });
  root.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const cube = event.target instanceof Element ? event.target.closest('.mini-cube') : null;
    if (!cube || cube.classList.contains('is-breaking')) return;
    cube.classList.add('is-breaking');
    const done = (e) => {
      if (e.animationName !== 'mini-cube-whole') return;
      cube.classList.remove('is-breaking');
      cube.removeEventListener('animationend', done);
    };
    cube.addEventListener('animationend', done);
  }, { passive: true });
}

export function wordmark() {
  return `<a href="#/" class="group flex items-center gap-2.5 rounded-lg" aria-label="WAMR3D home">${miniCube}<span class="font-display text-lg font-bold tracking-tight text-white">WAMR<span class="text-gradient">3D</span></span></a>`;
}

const icons = {
  github: '<svg viewBox="0 0 24 24" class="size-4.5" fill="currentColor" aria-hidden="true"><path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.56-.29-5.25-1.28-5.25-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.7 5.38-5.27 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z"/></svg>',
  npm: '<svg viewBox="0 0 24 24" class="size-4.5" fill="currentColor" aria-hidden="true"><path d="M2 7v9h6v1.5h4V16h10V7Zm6 7.5H6.5V10H5v4.5H3.5v-6H8Zm5.5 0h-3v1.5H9v-7.5h4.5Zm9 0H21V10h-1.5v4.5H18V10h-1.5v4.5h-3v-6h9Zm-12.5-4.5h1.5v3H10Z"/></svg>',
  arrow: '<svg viewBox="0 0 20 20" class="size-4" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 10h12m-5-5 5 5-5 5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  external: '<svg viewBox="0 0 20 20" class="size-3.5" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M7 13 13 7m-5 0h5v5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  copy: '<svg viewBox="0 0 20 20" class="size-4" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2"/><path d="M13 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/></svg>',
  check: '<svg viewBox="0 0 20 20" class="size-4" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m4 10.5 4 4 8-9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  system: '<svg viewBox="0 0 20 20" class="size-4.5" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="2.5" y="3.5" width="15" height="10" rx="1.5"/><path d="M7 17h6M10 13.5V17" stroke-linecap="round"/></svg>',
  light: '<svg viewBox="0 0 20 20" class="size-4.5" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="10" cy="10" r="3.5"/><path d="M10 1.5v2m0 13v2M1.5 10h2m13 0h2M4 4l1.4 1.4m9.2 9.2L16 16M4 16l1.4-1.4m9.2-9.2L16 4" stroke-linecap="round"/></svg>',
  dark: '<svg viewBox="0 0 20 20" class="size-4.5" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M16.5 12.5A7 7 0 0 1 7.5 3.5a7 7 0 1 0 9 9Z" stroke-linejoin="round"/></svg>',
  cross: '<svg viewBox="0 0 20 20" class="size-4" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" stroke-linecap="round"/></svg>'
};
export const icon = (name) => icons[name];

const navLinks = [
  ['Features', '#features', 'home'],
  ['Benchmarks', '#/benchmarks', 'benchmarks'],
  ['Demos', '#/examples', 'examples'],
  ['Docs', '#/docs', 'docs'],
  ['Migration', '#/migration', 'migration']
];

export function header(active) {
  const link = ([label, href, key]) => `<a href="${href}" class="rounded-full px-3.5 py-2 text-sm font-medium transition-colors ${active === key && key !== 'home' ? 'bg-white/10 text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white'}"${active === key && key !== 'home' ? ' aria-current="page"' : ''}>${label}</a>`;
  return `<header class="fixed inset-x-0 top-0 z-50 px-4 pt-4 sm:px-6">
    <nav class="menu-surface mx-auto flex max-w-6xl items-center justify-between gap-4 rounded-2xl px-3 py-2.5 sm:px-4" aria-label="Main">
      ${wordmark()}
      <div class="hidden items-center gap-1 lg:flex">${navLinks.map(link).join('')}<div class="relative"><button type="button" data-renderer-toggle class="rounded-full px-3.5 py-2 text-sm font-medium text-slate-300 transition hover:bg-white/5 hover:text-white" aria-label="Choose hero graphics backend" aria-expanded="false" aria-controls="renderer-popover"><span data-renderer-label>GPU: Auto</span><span class="ml-1 text-[10px]" aria-hidden="true">v</span></button><div id="renderer-popover" data-renderer-popover class="menu-surface absolute right-0 top-full z-50 mt-3 hidden w-72 rounded-2xl p-2">
        <p class="px-3 pb-2 pt-1 text-xs leading-relaxed text-slate-400">Choose how this website renders its 3D scene. Automatic tries WebGPU, WebGL 2, then software WebGPU.</p>
        <button type="button" data-renderer-choice="auto" class="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm text-slate-200 hover:bg-white/10"><span><span class="block font-medium">Automatic</span><span class="text-xs text-slate-400">WebGPU, WebGL 2, then software WebGPU</span></span><span data-renderer-check="auto" class="text-brand-cyan" aria-hidden="true"></span></button>
        <button type="button" data-renderer-choice="webgpu" class="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm text-slate-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"><span><span class="block font-medium">Prefer WebGPU</span><span data-webgpu-status class="text-xs text-slate-400">Checking support…</span></span><span data-renderer-check="webgpu" class="text-brand-cyan" aria-hidden="true"></span></button>
        <button type="button" data-renderer-choice="webgl" class="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm text-slate-200 hover:bg-white/10"><span><span class="block font-medium">WebGL 2 only</span><span class="text-xs text-slate-400">Use the compatibility backend</span></span><span data-renderer-check="webgl" class="text-brand-cyan" aria-hidden="true"></span></button>
      </div></div></div>
      <div class="flex items-center gap-1.5">
        <a href="${REPO}" class="hidden size-9 items-center justify-center rounded-full text-slate-300 transition hover:bg-white/10 hover:text-white sm:flex" aria-label="WAMR3D on GitHub" target="_blank" rel="noreferrer">${icons.github}</a>
        <a href="${NPM}" class="hidden size-9 items-center justify-center rounded-full text-slate-300 transition hover:bg-white/10 hover:text-white sm:flex" aria-label="wamr3d on npm" target="_blank" rel="noreferrer">${icons.npm}</a>
        <button type="button" data-theme-toggle class="flex size-9 items-center justify-center rounded-full text-slate-300 transition hover:bg-white/10 hover:text-white" aria-label="Theme: follows the system. Switch to light" title="Theme: system">${icons.system}</button>
        <a href="#install" class="hidden rounded-full bg-white px-4 py-2 text-sm font-semibold text-ink-950 transition hover:bg-brand-cyan sm:inline-flex">Get started</a>
        <button type="button" data-menu-toggle class="flex size-10 items-center justify-center rounded-xl text-slate-200 hover:bg-white/10 lg:hidden" aria-expanded="false" aria-controls="mobile-menu" aria-label="Open menu">
          <svg viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke-linecap="round"/></svg>
        </button>
      </div>
    </nav>
    <div id="mobile-menu" class="menu-surface mx-auto mt-2 hidden max-w-6xl flex-col gap-1 rounded-2xl p-3 lg:hidden" data-menu>
      ${navLinks.map(([label, href]) => `<a href="${href}" class="rounded-xl px-4 py-3 text-base font-medium text-slate-200 hover:bg-white/10">${label}</a>`).join('')}
      <div class="relative"><button type="button" data-renderer-toggle class="flex w-full items-center justify-between rounded-xl bg-brand-cyan/5 px-4 py-3 text-left text-sm text-slate-200 transition hover:bg-brand-cyan/10" aria-label="Choose hero graphics backend" aria-expanded="false" aria-controls="renderer-mobile-popover"><span><span class="block font-semibold">GPU: <span data-renderer-label>Auto</span></span><span class="mt-0.5 block text-xs text-slate-400">Auto tries WebGPU, WebGL 2, then software WebGPU</span></span><span class="font-mono text-xs text-brand-cyan" aria-hidden="true">v</span></button></div>
      <div class="mt-2 flex gap-2 border-t border-white/10 pt-3">
        <a href="${REPO}" target="_blank" rel="noreferrer" class="flex flex-1 items-center justify-center gap-2 rounded-xl bg-white/5 py-3 text-sm text-slate-200">${icons.github} GitHub</a>
        <a href="${NPM}" target="_blank" rel="noreferrer" class="flex flex-1 items-center justify-center gap-2 rounded-xl bg-white/5 py-3 text-sm text-slate-200">${icons.npm} npm</a>
      </div>
    </div>
  </header>`;
}

export function footer() {
  const col = (title, links) => `<div><h2 class="mb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-slate-400">${title}</h2><ul class="space-y-2 text-sm">${links.map(([label, href]) => `<li><a class="text-slate-400 transition hover:text-white" href="${href}"${href.startsWith('http') ? ' target="_blank" rel="noreferrer"' : ''}>${label}</a></li>`).join('')}</ul></div>`;
  return `<footer class="relative z-10 border-t border-white/10 bg-ink-950/80 backdrop-blur-xl">
    <div class="mx-auto grid max-w-6xl gap-10 px-6 py-14 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
      <div class="space-y-4">${wordmark()}<p class="max-w-xs text-sm leading-relaxed text-slate-400">A WebAssembly 3D engine with a Rust core and its own WebGPU renderer, and an API that follows three.js. MIT licensed.</p></div>
      ${col('Product', [['Features', '#features'], ['Benchmarks', '#/benchmarks'], ['Live demos', '#/examples'], ['Install', '#install']])}
      ${col('Learn', [['Documentation', '#/docs'], ['Migration from three.js', '#/migration'], ['Status', repoFile('STATUS.md')]])}
      ${col('Project', [['GitHub', REPO], ['npm', NPM], ['Issues', `${REPO}/issues`]])}
    </div>
    <div class="mx-auto flex max-w-6xl flex-col gap-2 border-t border-white/5 px-6 py-6 text-xs text-slate-400 sm:flex-row sm:justify-between">
      <span>Rust · WebAssembly · WebGPU. Checked against three.js</span>
      <span class="inline-flex items-center gap-3">Built with <span class="origin-center scale-75">${miniCube}</span> WAMR3D</span>
      <span>An independent project, not affiliated with three.js.</span>
    </div>
  </footer>`;
}

export function shell(content, active) {
  return `${header(active)}<main id="main" class="relative z-10">${content}</main>${footer()}`;
}

export function eyebrow(text) {
  return `<p class="mb-4 inline-flex items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-[0.22em] text-brand-cyan"><span class="h-px w-6 bg-gradient-to-r from-brand-violet to-brand-cyan"></span>${text}</p>`;
}

export function sectionHead({ label, title, intro = '', center = false }) {
  return `<div class="mb-12 max-w-3xl ${center ? 'mx-auto text-center' : ''}" data-reveal>${eyebrow(label)}<h2 class="font-display text-3xl font-semibold tracking-tight text-white sm:text-5xl">${title}</h2>${intro ? `<p class="mt-5 text-lg leading-relaxed text-slate-400">${intro}</p>` : ''}</div>`;
}

export function button(href, label, variant = 'primary', external = false) {
  const styles = {
    primary: 'bg-gradient-to-r from-brand-violet via-brand-blue to-brand-cyan text-white shadow-lg shadow-brand-blue/30 hover:shadow-brand-cyan/40 hover:brightness-110',
    secondary: 'glass text-white hover:bg-white/10',
    ghost: 'text-slate-300 hover:text-white'
  };
  return `<a href="${href}" class="group inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold transition-all duration-300 ${styles[variant]}"${external ? ' target="_blank" rel="noreferrer"' : ''}>${label}<span class="transition-transform duration-300 group-hover:translate-x-0.5">${external ? icons.external : icons.arrow}</span></a>`;
}

function highlight(code) {
  const pattern = /(\/\/.*$)|('(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`|"(?:[^"\\\n]|\\.)*")|\b(import|from|await|const|let|new|export|async|function|return|for|of)\b|\b(0x[0-9a-f]+|\d+(?:\.\d+)?)\b/gim;
  let out = '', last = 0;
  for (const match of code.matchAll(pattern)) {
    out += escape(code.slice(last, match.index));
    const kind = match[1] ? 'comment' : match[2] ? 'string' : match[3] ? 'keyword' : 'number';
    out += `<span class="code-token-${kind}">${escape(match[0])}</span>`;
    last = match.index + match[0].length;
  }
  return out + escape(code.slice(last));
}

function highlightDiff(code) {
  return code.split('\n').map((line) => {
    if (line.startsWith('- ')) return `<span class="code-token-removed">${escape(line)}</span>`;
    if (line.startsWith('+ ')) return `<span class="code-token-added">${escape(line)}</span>`;
    return `${highlight(line)}\n`;
  }).join('');
}

export function codeBlock(code, { title = '', language = 'js', diff = false, className = '' } = {}) {
  return `<figure class="gradient-border overflow-hidden rounded-2xl bg-ink-900/90 shadow-2xl shadow-black/50 ${className}">
    <figcaption class="flex items-center justify-between border-b border-white/5 px-4 py-2.5">
      <span class="flex items-center gap-3"><span class="flex gap-1.5" aria-hidden="true"><i class="size-2.5 rounded-full bg-white/15"></i><i class="size-2.5 rounded-full bg-white/15"></i><i class="size-2.5 rounded-full bg-white/15"></i></span><span class="font-mono text-xs text-slate-400">${title || language}</span></span>
      <button type="button" data-copy class="inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-xs text-slate-400 transition hover:bg-white/10 hover:text-white" aria-label="Copy code">${icons.copy}<span>Copy</span></button>
    </figcaption>
    <pre class="overflow-x-auto p-5 font-mono [font-variant-ligatures:none] text-[13px] leading-relaxed text-slate-200"><code data-code="${escape(code).replaceAll('"', '&quot;')}">${diff ? highlightDiff(code) : highlight(code)}</code></pre>
  </figure>`;
}

export function installChip(className = '') {
  return `<div class="glass inline-flex items-center gap-3 rounded-full py-1.5 pl-5 pr-1.5 ${className}">
    <code class="font-mono text-sm text-slate-200"><span class="select-none text-brand-cyan">$ </span>npm install wamr3d</code>
    <button type="button" data-copy-text="npm install wamr3d" class="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 font-mono text-xs text-slate-200 transition hover:bg-white/20" aria-label="Copy install command">${icons.copy}<span>Copy</span></button>
  </div>`;
}

// Secondary text, collapsed: the page reads in one pass and the detail is one click away.
export function more(summary, body, extra = '') {
  return `<details class="group mt-6 text-sm ${extra}" data-reveal>
    <summary class="inline-flex cursor-pointer list-none items-center gap-2 font-semibold text-brand-cyan transition hover:text-white [&::-webkit-details-marker]:hidden"><span class="inline-block transition-transform group-open:rotate-90" aria-hidden="true">▸</span>${summary}</summary>
    <div class="mt-4 leading-relaxed text-slate-400">${body}</div>
  </details>`;
}

export function pageIntro({ label, title, intro }) {
  return `<section class="mx-auto max-w-6xl px-6 pb-16 pt-40 sm:pt-48">
    <div class="max-w-3xl" data-reveal>${eyebrow(label)}<h1 class="font-display text-4xl font-semibold leading-[1.05] tracking-tight text-white sm:text-6xl">${title}</h1><p class="mt-6 text-lg leading-relaxed text-slate-300">${intro}</p></div>
  </section>`;
}
