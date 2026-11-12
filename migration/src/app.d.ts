import type { Bindings, ExecutionContextLike } from '$lib/d1';

declare global {
	namespace App {
		// Populated by @sveltejs/adapter-cloudflare's platform emulation. `env`
		// holds exactly the bindings declared in migration/wrangler.toml.
		interface Platform {
			env: Bindings;
			ctx?: ExecutionContextLike;
		}
	}
}

export {};
