import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		// One app deployment: server rendering on Cloudflare Workers, bindings
		// resolved through this directory's wrangler.toml only.
		adapter: adapter({ config: 'wrangler.toml' }),
		// Keep the framework's cross-origin form check on (an empty trusted-origin
		// list means only this origin is accepted); hooks.server.ts and the route
		// guards still perform their own explicit checks.
		csrf: { trustedOrigins: [] }
	}
};

export default config;
