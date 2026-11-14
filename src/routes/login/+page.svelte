<script lang="ts">
	import AuthFrame from '$lib/components/AuthFrame.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { submit } from '$lib/forms';
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
			// Use GIS's default popup mode so the credential comes back through the
			// callback and is posted by this page: `ux_mode: 'redirect'` hands the
			// credential to the page as a form POST issued from accounts.google.com,
			// which the framework's cross-site form guard rejects before any action
			// runs. `nonce` binds the returned ID token to this session's challenge
			// token, which the `google` action verifies.
			google.accounts.id.initialize({
				client_id: data.googleClientId,
				callback: (response: { credential?: string }) => {
					if (typeof response.credential === 'string') submitCredential(response.credential);
				},
				nonce: data.csrfToken
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

<AuthFrame>
	<h1>Sign in</h1>

	{#if data.devLoginEnabled}
		<div class="panel">
			<div class="panel__head"><Icon name="user" size={16} /><h2>Local fixtures</h2></div>
			<ul class="rows">
				{#each data.users as user (user.id)}
					<li>
						<form method="POST" action="?/dev" use:submit>
							<input type="hidden" name="csrf_token" value={data.csrfToken} />
							<input type="hidden" name="user_id" value={user.id} />
							<button class="row-button" type="submit">
								<span class="rows__main"><strong>{user.name}</strong><span class="cell__sub">{user.email}</span></span>
								<Icon name="next" size={16} />
							</button>
						</form>
					</li>
				{/each}
			</ul>
		</div>
		<p class="hint gap-top">Synthetic identities, loopback only.</p>
	{:else}
		<p class="muted">No local fixture identities are available on this host.</p>
	{/if}

	{#if data.googleConfigured}
		<div class="panel gap-top">
			<div class="panel__body">
				<div bind:this={googleHost} class="google-host"></div>
			</div>
		</div>
	{:else}
		<p class="hint gap-top">Google sign-in is not configured.</p>
	{/if}
</AuthFrame>
