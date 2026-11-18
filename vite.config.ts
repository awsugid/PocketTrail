import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	build: {
		// Provided by the Workers runtime (SMTP over TCP sockets); never bundled.
		rolldownOptions: { external: ['cloudflare:sockets'] }
	}
});
