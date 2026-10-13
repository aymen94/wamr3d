import './style.css';
import { home } from './pages/home.js';
import { docs } from './pages/docs.js';
import { benchmarks, examples, migration } from './pages/content.js';
import { startBackground } from './background.js';

const routes = { '/': home, '/docs': docs, '/benchmarks': benchmarks, '/examples': examples, '/migration': migration };
const app = document.querySelector('#app');
const repository = import.meta.env.VITE_REPOSITORY || 'aymen94/wamr3d';
const ref = import.meta.env.VITE_REF || 'main';

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('wamr3d-theme', theme);
  const button = app.querySelector('.theme-toggle');
  if (button) {
    button.textContent = theme === 'dark' ? 'Light' : 'Dark';
    button.setAttribute('aria-label', `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`);
  }
  window.dispatchEvent(new CustomEvent('wamr3d-theme', { detail: theme }));
}

function render() {
  const route = location.hash.replace(/^#/, '') || '/';
  app.innerHTML = (routes[route] || home)();
  document.title = route === '/' ? 'WAMR3D \u2014 A native core for the web' : `${route.slice(1).replace(/^./, c => c.toUpperCase())} \u2014 WAMR3D`;
  for (const link of app.querySelectorAll('[data-repo-link]')) {
    const path = link.dataset.path;
    link.href = `https://github.com/${repository}/${link.dataset.repoLink}/${ref}${path ? `/${path}` : ''}`;
    link.target = '_blank';
    link.rel = 'noreferrer';
  }
  app.querySelector('.menu')?.addEventListener('click', () => app.querySelector('nav').classList.toggle('open'));
  app.querySelector('.theme-toggle')?.addEventListener('click', () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
  revealOnScroll();
  app.querySelectorAll('[data-copy]').forEach(button => button.addEventListener('click', async () => {
    await navigator.clipboard.writeText(button.closest('.code').querySelector('code').textContent);
    button.textContent = 'Copied';
    setTimeout(() => button.textContent = 'Copy', 1200);
  }));
  applyTheme(document.documentElement.dataset.theme || 'dark');
  window.scrollTo(0, 0);
}

function revealOnScroll() {
  const items = app.querySelectorAll('.card, .metric, .example-feature, .doc-content article');
  if (!('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    items.forEach(item => item.classList.add('is-visible'));
    return;
  }
  const observer = new IntersectionObserver(entries => entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    entry.target.classList.add('is-visible');
    observer.unobserve(entry.target);
  }), { threshold: 0.12 });
  items.forEach((item, index) => {
    item.classList.add('scroll-reveal');
    item.style.setProperty('--reveal-delay', `${Math.min(index % 3, 2) * 70}ms`);
    observer.observe(item);
  });
}

const savedTheme = localStorage.getItem('wamr3d-theme');
if (savedTheme === 'light' || savedTheme === 'dark') document.documentElement.dataset.theme = savedTheme;
window.addEventListener('hashchange', render);
render();
startBackground(document.querySelector('#scene-bg'));
