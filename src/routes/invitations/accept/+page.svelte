<script lang="ts">
	import { fmtTs } from '$lib/fmt';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const inv = $derived(data.invitation);
	const emailMatches = $derived(
		data.viewer !== null && data.viewer.email.toLowerCase() === inv.email.toLowerCase()
	);
</script>

<svelte:head>
	<title>Invitation · PocketTrail</title>
</svelte:head>

<main class="auth-column">
	<h1>You are invited</h1>
	<p class="lede">
		Join <strong>{inv.orgName}</strong> as <strong>{inv.roleName}</strong>.
	</p>
	<p class="meta-line">
		<span>Invitation for {inv.email}</span>
		<span>Expires {fmtTs(inv.expiresAt)}</span>
	</p>

	{#if data.viewer === null}
		<p class="notice">Sign in first. Accepting needs the verified Google account for {inv.email}.</p>
		<p><a class="btn btn--primary" href="/login">Sign in</a></p>
	{:else if !data.viewer.verified}
		<p class="notice notice--danger">
			You are signed in as {data.viewer.email}, which is not a verified Google account. Accepting an invitation
			requires Google sign-in so the email can be trusted.
		</p>
		<form method="POST" action="/logout">
			<input type="hidden" name="csrf_token" value={data.viewer.csrf} />
			<button class="btn" type="submit">Sign out</button>
		</form>
	{:else if !emailMatches}
		<p class="notice notice--danger">
			You are signed in as {data.viewer.email}, but this invitation is for {inv.email}. Sign out and sign in with
			the invited account.
		</p>
		<form method="POST" action="/logout">
			<input type="hidden" name="csrf_token" value={data.viewer.csrf} />
			<button class="btn" type="submit">Sign out</button>
		</form>
	{:else}
		<p class="muted">Signed in as {data.viewer.email}. Accepting adds your membership immediately.</p>
		<form method="POST" action="?/accept">
			<input type="hidden" name="csrf_token" value={data.viewer.csrf} />
			<input type="hidden" name="token" value={data.token} />
			<button class="btn btn--primary" type="submit">Accept invitation to {inv.orgName}</button>
		</form>
	{/if}
</main>
