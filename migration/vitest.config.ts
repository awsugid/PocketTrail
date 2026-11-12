import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Unit tests cover the pure server modules only (session codec, permission
// evaluation, money parsing/formatting). They run in plain Node, without the
// SvelteKit plugin or Cloudflare bindings; runtime behaviour is covered by
// `npm run test:e2e`, which drives the built Worker under `wrangler dev`.
export default defineConfig({
	resolve: {
		// Mirrors the `$lib` alias SvelteKit generates, so tests can import the
		// real modules under test rather than copies.
		alias: { $lib: fileURLToPath(new URL('./src/lib', import.meta.url)) }
	},
	test: {
		include: ['tests/**/*.test.ts'],
		environment: 'node'
	}
});

