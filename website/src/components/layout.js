export const links = [
  [ 'Docs', '#/docs' ], [ 'Benchmarks', '#/benchmarks' ],
  [ 'Examples', '#/examples' ], [ 'Migration', '#/migration' ]
];

function brand() {
  return `<a class="wordmark" href="#/" aria-label="WAMR3D: WebAssembly Accelerated Modular Rendering 3D"><span class="mark">W</span><span class="brand-name" aria-hidden="true"><span class="logo-letter">W</span><span class="logo-letter">A</span><span class="logo-letter">M</span><span class="logo-letter">R</span><span class="accent">3D</span></span><span class="logo-expansion" aria-hidden="true">W <i>WebAssembly</i><br>A <i>Accelerated</i><br>M <i>Modular</i><br>R <i>Rendering</i><br>3D <i>Three-dimensional</i></span></a>`;
}

export function header(active = '') {
  return `<header class="topbar">${brand()}<nav>${links.map(([label, href]) => `<a class="${active === label ? 'active' : ''}" href="${href}">${label}</a>`).join('')}<a href="https://github.com/aymen94/wamr3d">GitHub &nearr;</a></nav><div class="header-actions"><button class="theme-toggle" type="button" aria-label="Switch color theme"></button><button class="menu" aria-label="Toggle navigation">Menu</button></div></header>`;
}

export function footer() {
  return `<footer class="footer">${brand()}<span>Rust &middot; WebAssembly &middot; WebGPU</span><a href="https://github.com/aymen94/wamr3d">Open source &nearr;</a></footer>`;
}

export function shell(content, active = '') {
  return `${header(active)}<main>${content}</main>${footer()}`;
}

export function sectionLabel(number, text) { return `<p class="kicker"><span>${number}</span> / ${text}</p>`; }

export function cards(items) {
  return `<div class="cards">${items.map(([tag, title, body, href]) => `<a class="card" href="${href}"><span class="card-tag">${tag}</span><strong>${title}<i>&nearr;</i></strong><p>${body}</p></a>`).join('')}</div>`;
}

export function codeBlock(code, language = 'js') {
  return `<div class="code"><div class="code-top"><span>${language}</span><button data-copy>Copy</button></div><pre><code>${code.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</code></pre></div>`;
}
