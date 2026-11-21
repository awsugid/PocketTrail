import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		// One app deployment: server rendering on Cloudflare Workers, bindings
		// resolved through this directory's wrangler.toml only.
		adapter: adapter({ config: 'wrangler.toml' }),
		// hooks.server.ts enforces the same strict form-origin gate, except the
		// non-cookie OAuth token exchange (PKCE), which runs before route resolve.
		csrf: { checkOrigin: false }
	}
};

export default config;
