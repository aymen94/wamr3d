import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const websiteRoot = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(websiteRoot, '..');

// The home page is rendered into index.html at build time, so its content is in the HTML
// that search engines and link previews read. The client keeps that markup on first load.
const prerender = () => ({
	name: 'wamr3d-prerender',
	async transformIndexHtml(html) {
		const { routes } = await import(`${pathToFileURL(path.join(websiteRoot, 'src', 'pages', 'index.js')).href}?t=${Date.now()}`);
		// The headline in the title and descriptions comes from the measured data, with its condition.
		const { headlineShort, headlineDetail } = await import(`${pathToFileURL(path.join(websiteRoot, 'src', 'data', 'headline.js')).href}?t=${Date.now()}`);
		const sentence = headlineShort ? `Renders ${headlineShort} (${headlineDetail}).` : '';
		return html
			.replaceAll(', %WAMR3D_HEADLINE%', headlineShort ? `, ${headlineShort}` : '')
			.replaceAll(' %WAMR3D_HEADLINE_SENTENCE%', sentence ? ` ${sentence}` : '')
			.replace('<!--app-->', routes['/'].render());
	}
});

// During development the demos, the parity page, the WebAssembly package and the icons are
// served from the repository, at the same paths they have in the built site.
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.ico': 'image/vnd.microsoft.icon', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const projectFiles = () => ({
	name: 'wamr3d-project-files',
	configureServer(server) {
		server.middlewares.use((request, response, next) => {
			const url = decodeURIComponent(request.url.split('?')[0]);
			const mapped = /^\/(examples|parity\/visual|dist\/wamr3d)\//.test(url) || /^\/[\w.-]+\.(ico|png|webmanifest)$/.test(url) ? url : null;
			if (!mapped) return next();
			let file = path.join(projectRoot, mapped);
			if (!file.startsWith(projectRoot)) return next();
			// Without a local engine build, serve the installed package, as the built site does.
			if (mapped.startsWith('/dist/wamr3d/') && !fs.existsSync(file)) file = path.join(websiteRoot, 'node_modules', 'wamr3d', mapped.slice('/dist/wamr3d/'.length));
			if (!file.startsWith(projectRoot)) return next();
			if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
			if (!fs.existsSync(file)) return next();
			response.setHeader('Content-Type', MIME[path.extname(file)] ?? 'application/octet-stream');
			fs.createReadStream(file).pipe(response);
		});
	}
});

export default defineConfig({
	base: './',
	plugins: [tailwindcss(), prerender(), projectFiles()],
	// Pre-bundling would move the package's JS away from its .wasm file, which it locates through import.meta.url.
	optimizeDeps: { exclude: ['wamr3d'] },
	server: { fs: { allow: [projectRoot] } },
	build: {
		outDir: 'dist',
		emptyOutDir: true
	}
});
