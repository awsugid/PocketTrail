<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let googleHost: HTMLDivElement | undefined = $state();

	let credentialsSent = $state(false);

	function submitCredential(credential: string) {
		if (credentialsSent) return;
		credentialsSent = true;
		const form = document.createElement('form');
		form.method = 'POST';
		form.action = '/login?/google';
		const add = (name: string, value: string) => {
			const input = document.createElement('input');
			input.type = 'hidden';
			input.name = name;
			input.value = value;
			form.appendChild(input);
		};
		add('csrf_token', data.csrfToken);
		add('credential', credential);
		document.body.appendChild(form);
		form.submit();
	}

interface GoogleIdentity {
		accounts: {
			id: {
				initialize(config: unknown): void;
				renderButton(host: HTMLElement, options?: Record<string, unknown>): void;
			};
		};
	}

	function gisLoaded(): GoogleIdentity | null {
		return (window as unknown as { google?: GoogleIdentity }).google ?? null;
	}

	let loadPromise: Promise<GoogleIdentity | null> | null = null;

	/** Load Google Identity Services on demand so the sign-in page never
	 * depends on a blocking third-party script. */
	function ensureGis(): Promise<GoogleIdentity | null> {
		const ready = gisLoaded();
		if (ready) return Promise.resolve(ready);
		if (loadPromise) return loadPromise;
		loadPromise = new Promise((resolve) => {
			const script = document.createElement('script');
			script.src = 'https://accounts.google.com/gsi/client';
			script.async = true;
			script.defer = true;
			script.onload = () => resolve(gisLoaded());
			script.onerror = () => resolve(null);
			document.head.appendChild(script);
		});
		return loadPromise;
	}

	$effect(() => {
		if (!googleHost || !data.googleConfigured) return;
		const host = googleHost;
		let cancelled = false;
		void ensureGis().then((google) => {
			if (cancelled || !google) return;
			google.accounts.id.initialize({
				client_id: data.googleClientId,
				callback: (response: { credential?: string }) => {
					if (typeof response.credential === 'string') submitCredential(response.credential);
				},
				ux_mode: 'redirect'
			});
			google.accounts.id.renderButton(host, { theme: 'outline', size: 'large', width: 320 });
		});
		return () => {
			cancelled = true;
		};
	});
</script>

<svelte:head>
	<title>Sign in · PocketTrail</title>
</svelte:head>

<main class="auth-column">
	<h1>Sign in</h1>
	<p class="lede">PocketTrail records community finances for AWS User Group organizers.</p>

	{#if data.devLoginEnabled}
		<p class="notice">
			Local fixture sign-in. These synthetic identities only work on this machine's loopback address, and
			this form is never served by a deployed PocketTrail instance.
		</p>
		<ul class="choice-list">
			{#each data.users as user (user.id)}
				<li>
					<form method="POST" action="?/dev">
						<input type="hidden" name="csrf_token" value={data.csrfToken} />
						<input type="hidden" name="user_id" value={user.id} />
						<button class="btn" type="submit">
							{user.name}
							<span class="muted">{user.email}</span>
						</button>
					</form>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="muted">No local fixture identities are available on this host.</p>
	{/if}

	{#if data.googleConfigured}
		<div class="notice">
			<p style="margin-top: 0">Use your Google account to continue.</p>
			<div bind:this={googleHost} class="google-host"></div>
		</div>
	{:else}
		<p class="muted" style="margin-top: 16px">
			Google sign-in is not configured. Set <code>GOOGLE_CLIENT_ID</code> in <code>.dev.vars</code> to enable it.
		</p>
	{/if}
</main>
