<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Organizations · PocketTrail</title>
</svelte:head>

<header class="masthead">
	<span class="masthead__org-name">PocketTrail</span>
	<nav class="masthead__nav" aria-label="Account">
		<span class="muted">{data.user.name}</span>
		<form method="POST" action="/logout">
			<input type="hidden" name="csrf_token" value={data.csrfToken} />
			<button class="btn btn--quiet" type="submit">Sign out</button>
		</form>
	</nav>
</header>

<div class="page-head">
	<div>
		<h1>Choose an organization</h1>
		<p class="lede">
			Financial records, roles, and notifications stay inside one organization. Your membership
			determines what you can see here.
		</p>
	</div>
</div>

{#if data.organizations.length > 0}
	<ul class="plain-list" style="margin-top: 24px; max-width: 60ch">
		{#each data.organizations as org (org.slug)}
			<li>
				<a href="/org/{org.slug}/ledger">{org.name}</a>
			</li>
		{/each}
	</ul>
	<p class="meta-line">
		{#if data.user.isPlatformAdmin}
			<span>Platform administrator: this does not grant access to organization finances.</span>
		{:else}
			<span>Ask an organization's member manager if you need access to another workspace.</span>
		{/if}
	</p>
{:else}
	<div class="empty-state">
		<p>Your account is not an active member of any organization yet.</p>
		<p class="muted">
			An organization member with the manage-members permission can add you. Accepting an invitation
			happens from the invitation link you were sent.
		</p>
	</div>
{/if}
