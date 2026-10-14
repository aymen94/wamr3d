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
		return html.replace('<!--app-->', routes['/'].render());
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
			if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
			if (!fs.existsSync(file)) return next();
			response.setHeader('Content-Type', MIME[path.extname(file)] ?? 'application/octet-stream');
			fs.createReadStream(file).pipe(response);
		});
	}
});

export default defineConfig(({ command }) => ({
	base: './',
	plugins: [tailwindcss(), prerender(), projectFiles()],
	define: command === 'serve' ? {
		'import.meta.env.WAMR3D_DEV_PACKAGE': JSON.stringify('/dist/wamr3d/compat.js')
	} : {},
	server: { fs: { allow: [projectRoot] } },
	build: {
		outDir: 'dist',
		emptyOutDir: true
	}
}));
