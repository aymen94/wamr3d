import './styles.css';
import { routes } from './pages/index.js';
import { barText, barWidth, chartTableBody, chartValues, counts, scalingRows } from './components/charts.js';
import { engines } from './data/benchmarks.js';
import { icon } from './components/ui.js';

const app = document.querySelector('#app');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let sceneStarted = false;

function parseHash() {
  const fragment = location.hash.slice(1);
  if (!fragment.startsWith('/')) return { route: '/', anchor: fragment };
  const [route, anchor] = fragment.split('#');
  return { route: routes[route] ? route : '/', anchor };
}

let currentRoute = null;

function render() {
  const { route, anchor } = parseHash();
  const swap = () => {
    if (route !== currentRoute) {
      // The home page is prerendered into index.html; keep that markup on first load.
      if (!(currentRoute === null && route === '/' && app.dataset.prerendered === '/')) app.innerHTML = routes[route].render();
      currentRoute = route;
      document.documentElement.dataset.route = route;
      document.title = routes[route].title;
      document.querySelector('meta[name="description"]')?.setAttribute('content', routes[route].description);
      bind();
    }
    if (anchor) document.getElementById(anchor)?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
    else scrollTo(0, 0);
  };
  if (document.startViewTransition && currentRoute !== null && route !== currentRoute && !reducedMotion) document.startViewTransition(swap);
  else swap();
}

// Theme: 'system' (default) follows the OS; 'light' and 'dark' are explicit choices.
const THEMES = ['system', 'light', 'dark'];
const systemLight = matchMedia('(prefers-color-scheme: light)');
const themeNames = { system: 'follows the system', light: 'light', dark: 'dark' };

function themePreference() {
  try { return THEMES.includes(localStorage.getItem('wamr3d-theme')) ? localStorage.getItem('wamr3d-theme') : 'system'; } catch { return 'system'; }
}

function applyTheme(pref) {
  const theme = pref === 'system' ? (systemLight.matches ? 'light' : 'dark') : pref;
  const root = document.documentElement;
  const changed = root.dataset.theme !== theme;
  root.dataset.theme = theme;
  root.dataset.themePref = pref;
  app.querySelectorAll('[data-theme-toggle]').forEach((button) => {
    const next = THEMES[(THEMES.indexOf(pref) + 1) % THEMES.length];
    button.innerHTML = icon(pref);
    button.title = `Theme: ${pref}`;
    button.setAttribute('aria-label', `Theme: ${themeNames[pref]}. Switch to ${next}`);
  });
  if (changed) window.dispatchEvent(new CustomEvent('wamr3d-theme', { detail: theme }));
}

// Kept in memory too, so the toggle still cycles when storage is unavailable.
let currentPref = themePreference();
systemLight.addEventListener('change', () => { if (currentPref === 'system') applyTheme('system'); });

function bind() {
  applyTheme(currentPref);
  app.querySelector('[data-theme-toggle]')?.addEventListener('click', () => {
    const next = THEMES[(THEMES.indexOf(currentPref) + 1) % THEMES.length];
    currentPref = next;
    try { localStorage.setItem('wamr3d-theme', next); } catch {}
    applyTheme(next);
  });

  const toggle = app.querySelector('[data-menu-toggle]');
  const menu = app.querySelector('[data-menu]');
  toggle?.addEventListener('click', () => {
    const open = menu.classList.toggle('hidden') === false;
    menu.classList.toggle('flex', open);
    toggle.setAttribute('aria-expanded', String(open));
  });
  menu?.addEventListener('click', (event) => { if (event.target.closest('a')) { menu.classList.add('hidden'); menu.classList.remove('flex'); toggle.setAttribute('aria-expanded', 'false'); } });

  app.querySelectorAll('[data-copy], [data-copy-text]').forEach((button) => button.addEventListener('click', async () => {
    const text = button.dataset.copyText ?? button.closest('figure').querySelector('[data-code]').dataset.code;
    const label = button.querySelector('span');
    try {
      await navigator.clipboard.writeText(text);
      label.textContent = 'Copied';
    } catch {
      label.textContent = 'Press Ctrl+C';
    }
    setTimeout(() => { label.textContent = 'Copy'; }, 1400);
  }));

  app.querySelectorAll('[data-chart]').forEach(bindChart);
  app.querySelector('[data-demo-start]')?.addEventListener('click', startDemo);
  updateSceneStatus();
  reveal();
}

function bindChart(chart) {
  const update = () => {
    const mode = chart.dataset.mode, count = Number(chart.dataset.count), resolution = chart.dataset.resolution;
    chart.querySelectorAll('[data-chart-resolution]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.chartResolution === resolution)));
    chart.querySelectorAll('[data-chart-mode]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.chartMode === mode)));
    chart.querySelectorAll('[data-chart-count]').forEach((b) => {
      b.setAttribute('aria-checked', String(Number(b.dataset.chartCount) === count));
      b.disabled = !counts[mode].includes(Number(b.dataset.chartCount));
    });
    for (const { metric, values, max } of chartValues(resolution, mode, count)) {
      engines.forEach((engine, i) => {
        const id = `${engine.id}-${metric.key}`;
        const text = `${engine.label}: ${values[i] === null ? 'not measured' : `${values[i].toFixed(metric.digits)} ${metric.unit}`}`;
        const bar = chart.querySelector(`[data-bar="${id}"]`);
        bar.style.width = barWidth(values[i], max);
        bar.dataset.tip = text;
        bar.setAttribute('aria-label', text);
        chart.querySelector(`[data-value="${id}"]`).textContent = barText(values[i], metric);
      });
    }
    chart.querySelector('[data-chart-table]').innerHTML = chartTableBody(resolution, mode, count);
    chart.querySelector('[data-scaling-rows]').innerHTML = scalingRows(mode, count);
  };
  chart.addEventListener('click', (event) => {
    const resolution = event.target.closest('[data-chart-resolution]')?.dataset.chartResolution;
    const mode = event.target.closest('[data-chart-mode]')?.dataset.chartMode;
    const count = event.target.closest('[data-chart-count]')?.dataset.chartCount;
    if (resolution) chart.dataset.resolution = resolution;
    if (mode) {
      chart.dataset.mode = mode;
      if (!counts[mode].includes(Number(chart.dataset.count))) chart.dataset.count = '50000';
    }
    if (count) chart.dataset.count = count;
    if (resolution || mode || count) update();
  });
  chart.addEventListener('keydown', (event) => {
    const radio = event.target.closest('[role="radio"]');
    if (!radio || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    const options = [...radio.parentElement.querySelectorAll('[role="radio"]:not(:disabled)')];
    const next = options[(options.indexOf(radio) + (event.key === 'ArrowRight' ? 1 : -1) + options.length) % options.length];
    next.focus();
    next.click();
  });

  // One tooltip for every bar, on hover and on keyboard focus.
  const tip = document.createElement('div');
  tip.className = 'pointer-events-none fixed z-[60] hidden rounded-lg bg-white px-2.5 py-1.5 font-mono text-xs text-ink-950 shadow-xl';
  tip.setAttribute('role', 'tooltip');
  chart.append(tip);
  const show = (bar, x, y) => { tip.textContent = bar.dataset.tip; tip.classList.remove('hidden'); tip.style.left = `${x + 12}px`; tip.style.top = `${y - 36}px`; };
  chart.addEventListener('pointermove', (event) => {
    const bar = event.target.closest('[data-bar-row]')?.querySelector('[data-bar]');
    if (bar) show(bar, event.clientX, event.clientY); else tip.classList.add('hidden');
  });
  chart.addEventListener('pointerleave', () => tip.classList.add('hidden'));
  chart.addEventListener('focusin', (event) => {
    if (!event.target.matches('[data-bar]')) return;
    const r = event.target.getBoundingClientRect();
    show(event.target, r.right, r.top + 4);
  });
  chart.addEventListener('focusout', () => tip.classList.add('hidden'));
}

function startDemo(event) {
  const container = event.currentTarget.closest('[data-demo]');
  const frame = document.createElement('iframe');
  frame.src = './examples/webgpu/index.html';
  frame.title = 'WAMR3D WebGPU demo';
  frame.allow = 'fullscreen';
  frame.className = 'absolute inset-0 size-full border-0';
  container.querySelector('[data-demo-poster]').replaceWith(frame);
  frame.focus();
}

function reveal() {
  const items = app.querySelectorAll('[data-reveal]');
  if (reducedMotion || !('IntersectionObserver' in window)) return;
  document.documentElement.classList.add('reveal-ready');
  const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
    if (!entry.isIntersecting) return;
    entry.target.classList.add('is-visible');
    observer.unobserve(entry.target);
  }), { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });
  items.forEach((item) => {
    // Already on screen: show at once rather than animating content the reader is looking at.
    if (item.getBoundingClientRect().top < innerHeight * 0.9) item.classList.add('is-visible');
    else observer.observe(item);
  });
}

// Live state of the WAMR3D backdrop, shown in the hero badge.
let sceneState = { state: 'starting' };
function updateSceneStatus() {
  const text = app.querySelector('[data-scene-text]');
  const hint = app.querySelector('[data-scene-hint]');
  if (!text) return;
  const { state } = sceneState;
  if (state === 'running' && sceneState.fps) text.textContent = `Rendered live by WAMR3D · WebGPU · ${Math.round(sceneState.fps)} fps · ${sceneState.instances.toLocaleString('en-US')} instances · ${sceneState.calls} draw calls`;
  else if (state === 'running') text.textContent = 'Rendered live by WAMR3D · WebGPU';
  else if (state === 'static') text.textContent = 'Rendered by WAMR3D · WebGPU · motion paused (reduced motion)';
  else if (state === 'unsupported') text.textContent = `${sceneState.reason} The backdrop is static; the engine needs WebGPU.`;
  if (hint) hint.hidden = state === 'unsupported';
  text.previousElementSibling?.classList.toggle('bg-brand-cyan', state !== 'unsupported');
  text.previousElementSibling?.classList.toggle('bg-amber-400', state === 'unsupported');
}

function startScene() {
  if (sceneStarted) return;
  sceneStarted = true;
  const canvas = document.querySelector('#scene');
  import('./scene/hero-scene.js').then(({ startHeroScene }) => startHeroScene(canvas, (state) => {
    sceneState = { ...sceneState, ...state };
    updateSceneStatus();
  })).catch((error) => {
    console.info(error);
    sceneState = { state: 'unsupported', reason: 'The live scene could not start.' };
    updateSceneStatus();
  });
}

// The skip link must not change the hash: here a hash names a route.
document.querySelector('[data-skip]')?.addEventListener('click', (event) => {
  event.preventDefault();
  const main = document.querySelector('#main');
  main.setAttribute('tabindex', '-1');
  main.focus();
});

window.addEventListener('hashchange', render);
render();
// Let the page paint first; the engine and its WebAssembly load afterwards.
('requestIdleCallback' in window ? requestIdleCallback : (fn) => setTimeout(fn, 200))(startScene, { timeout: 1200 });
