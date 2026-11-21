<script lang="ts">
	import { Button } from '#lib/components/ui/button/index.ts';
	import AuthFrame from '#lib/components/AuthFrame.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import Notice from '#lib/components/Notice.svelte';
	import { fmtMoment } from '#lib/fmt.ts';
	import { guard, submit } from '#lib/forms.ts';
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

<AuthFrame>
	<h1>{inv.orgName}</h1>
	<div class="panel">
		<dl class="panel__body facts">
			<dt>Role</dt>
			<dd>{inv.roleName}</dd>
			<dt>Invited</dt>
			<dd>{inv.email}</dd>
			<dt>Expires</dt>
			<dd>{fmtMoment(inv.expiresAt)}</dd>
		</dl>
	</div>

	<div class="gap-top">
		{#if data.viewer === null}
			<Notice tone="warning">Sign in with the Google account for {inv.email} to accept.</Notice>
			<a class="btn btn--primary" href="/login"><Icon name="user" size={16} />Sign in</a>
		{:else if !data.viewer.verified || !emailMatches}
			<Notice tone="danger">
				{#if !data.viewer.verified}
					{data.viewer.email} is not a verified Google account.
				{:else}
					You are signed in as {data.viewer.email}, not {inv.email}.
				{/if}
			</Notice>
			<form method="POST" action="/logout" use:guard>
				<input type="hidden" name="csrf_token" value={data.viewer.csrf} />
				<Button class="" type="submit" variant="outline"><Icon name="logout" size={16} />Sign out</Button>
			</form>
		{:else}
			<form method="POST" action="?/accept" use:submit>
				<input type="hidden" name="csrf_token" value={data.viewer.csrf} />
				<input type="hidden" name="token" value={data.token} />
				<Button class="" type="submit" variant="default"><Icon name="check" size={16} />Join {inv.orgName}</Button>
			</form>
		{/if}
	</div>
</AuthFrame>
