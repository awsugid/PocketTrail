<script lang="ts">
	import { fmtTs } from '$lib/fmt';
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
		{#if data.user.isPlatformAdmin}
			<a href="/platform">Platform admin</a>
		{/if}
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

{#if data.msg}
	<p class="notice" role="status">{data.msg}</p>
{/if}

{#if data.invitations.length > 0}
	<section class="hub-section" aria-labelledby="invitations-heading">
		<h2 id="invitations-heading">Pending invitations</h2>
		<p class="muted">
			Accepting grants your account the listed role. Each invitation is for one email address and
			expires on its own date.
		</p>
		<ul class="plain-list invite-list">
			{#each data.invitations as invitation (invitation.id)}
				<li>
					<form method="POST" action="/invitations/{invitation.id}/accept">
						<input type="hidden" name="csrf_token" value={data.csrfToken} />
						<span class="invite-list__org">{invitation.orgName}</span>
						<span class="cell__sub">as {invitation.roleName} · expires {fmtTs(invitation.expiresAt)}</span>
						<button class="btn btn--primary" type="submit">
							Accept invitation to {invitation.orgName}
						</button>
					</form>
				</li>
			{/each}
		</ul>
	</section>
{/if}

{#if data.organizations.length > 0}
	<section class="hub-section" aria-labelledby="orgs-heading">
		<h2 id="orgs-heading">Your organizations</h2>
		<ul class="plain-list" style="max-width: 60ch">
			{#each data.organizations as org (org.slug)}
				<li>
					<a href="/org/{org.slug}/transactions">{org.name}</a>
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
	</section>
{:else}
	<div class="empty-state">
		<p>Your account is not an active member of any organization yet.</p>
		{#if data.invitations.length === 0}
			<p class="muted">
				An organization member with the manage-members permission can invite you, or a platform
				administrator can add you directly.
			</p>
		{/if}
	</div>
{/if}

{#if data.canCreate}
	<section class="hub-section" aria-labelledby="create-heading">
		<h2 id="create-heading">Create organization</h2>
		<p class="muted">
			Platform administrators only. Creating an organization does not add members; membership is
			invite-based.
		</p>
		<form method="POST" action="/orgs?/create" class="create-org">
			<input type="hidden" name="csrf_token" value={data.csrfToken} />
			<div class="field">
				<label for="org-name">Name</label>
				<input class="input" id="org-name" name="name" required maxlength="120" />
			</div>
			<div class="field">
				<label for="org-slug">URL identifier</label>
				<input class="input" id="org-slug" name="slug" required pattern="[a-z0-9-]+" title="Lowercase letters, digits, hyphens" aria-describedby="org-slug-hint" />
				<p class="cell__sub" id="org-slug-hint">
					Lowercase letters, digits, and hyphens (2–48 characters, no leading or trailing hyphen).
					Example: jakarta gives /org/jakarta/transactions.
				</p>
			</div>
			<button class="btn btn--primary" type="submit">Create organization</button>
		</form>
	</section>
{/if}

<style>
	.hub-section {
		margin: 24px 0;
		max-width: 60ch;
	}
	.hub-section h2 {
		font-size: 16px;
		margin: 0 0 8px;
	}
	.invite-list li {
		margin: 12px 0;
	}
	.invite-list form {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px;
	}
	.invite-list__org {
		font-weight: 650;
	}
	.create-org {
		display: grid;
		gap: 14px;
		max-width: 46ch;
	}
</style>
