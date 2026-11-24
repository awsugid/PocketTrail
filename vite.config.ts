import adapter from '@sveltejs/adapter-cloudflare';
import { rename, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

const cloudflare = adapter({ config: 'wrangler.toml' });
const adapt = cloudflare.adapt.bind(cloudflare);
cloudflare.adapt = async (builder) => {
	await adapt(builder);
	const dir = `${builder.getBuildDirectory('cloudflare')}/worker`;
	const scheduled = relative(dir, resolve('src/lib/server/scheduled.ts'));
	await rename(`${dir}/index.js`, `${dir}/fetch.js`);
	await writeFile(`${dir}/index.js`, `import app from './fetch.js';
import { runScheduled } from '${scheduled}';
export default { ...app, scheduled(_controller, env, ctx) { ctx.waitUntil(runScheduled(env)); } };
`);
};
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
			adapter: cloudflare,

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
