import type { Bindings, ExecutionContextLike } from '#lib/d1.ts';


declare global {
	namespace App {
		// Populated by hooks.server.ts from cloudflare:workers bindings.
		interface Platform {
			env: Bindings;
			ctx?: ExecutionContextLike;
		}
	}
}

export {};
