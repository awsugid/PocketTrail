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

	$effect(() => {
		if (!googleHost || !data.googleConfigured) return;
		const google = (window as unknown as { google?: { accounts: { id: { initialize(config: unknown): void; renderButton(host: HTMLElement, options?: Record<string, unknown>): void } } } }).google;
		if (!google) return;
		google.accounts.id.initialize({
			client_id: data.googleClientId,
			callback: (response: { credential?: string }) => {
				if (typeof response.credential === 'string') submitCredential(response.credential);
			},
			ux_mode: 'redirect'
		});
		google.accounts.id.renderButton(googleHost, { theme: 'outline', size: 'large', width: 320 });
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
