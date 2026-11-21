import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	build: {
		// Provided by the Workers runtime (SMTP over TCP sockets); never bundled.
		rolldownOptions: { external: ['cloudflare:sockets'] }
	}
});
