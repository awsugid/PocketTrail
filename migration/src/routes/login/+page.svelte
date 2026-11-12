<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
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
			Google sign-in is configured but not yet available in this migration slice. Use a local fixture
			identity on this machine.
		</div>
	{:else}
		<p class="muted" style="margin-top: 16px">
			Google sign-in is not configured. Set <code>GOOGLE_CLIENT_ID</code> in <code>.dev.vars</code> once
			token verification is ported.
		</p>
	{/if}
</main>
