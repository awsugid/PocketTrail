import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			preprocess: vitePreprocess(),
			// One app deployment: server rendering on Cloudflare Workers, bindings
			// resolved through this directory's wrangler.toml only.
			adapter: adapter({ config: 'wrangler.toml' }),

			// hooks.server.ts enforces the same strict form-origin gate, except the
			// non-cookie OAuth token exchange (PKCE), which runs before route resolve.
			csrf: {
				// The hook rejects cross-origin forms before resolve; OAuth uses PKCE.
				trustedOrigins: ['*']
			}
		})
	],
	build: {
		// Provided by the Workers runtime (SMTP over TCP sockets); never bundled.
		rolldownOptions: { external: ['cloudflare:sockets', 'cloudflare:workers'] }
	}
});
