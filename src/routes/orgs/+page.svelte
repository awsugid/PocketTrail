<script lang="ts">
	import AccountShell from '$lib/components/AccountShell.svelte';
	import Empty from '$lib/components/Empty.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import PageHead from '$lib/components/PageHead.svelte';
	import { fmtTs } from '$lib/fmt';
	import { guard, submit } from '$lib/forms';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Organizations · PocketTrail</title>
</svelte:head>

<AccountShell user={data.user} csrfToken={data.csrfToken}>
	<PageHead title="Organizations" icon="org" />

	{#if data.msg}<Notice tone="success">{data.msg}</Notice>{/if}

	<div class="stack">
		{#if data.invitations.length > 0}
			<section class="panel" aria-labelledby="invitations-heading">
				<div class="panel__head">
					<Icon name="mail" size={16} /><h2 id="invitations-heading">Invitations</h2>
					<span class="count">{data.invitations.length}</span>
				</div>
				<ul class="rows">
					{#each data.invitations as invitation (invitation.id)}
						<li>
							<div class="rows__main">
								<strong>{invitation.orgName}</strong>
								<span class="rows__sub">{invitation.roleName} · expires {fmtTs(invitation.expiresAt)}</span>
							</div>
							<form method="POST" action="/invitations/{invitation.id}/accept" use:guard>
								<input type="hidden" name="csrf_token" value={data.csrfToken} />
								<button class="btn btn--primary btn--sm" type="submit">
									<Icon name="check" size={16} />Accept<span class="visually-hidden"> invitation to {invitation.orgName}</span>
								</button>
							</form>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if data.organizations.length > 0}
			<section class="panel" aria-label="Your organizations">
				<ul class="rows rows--link">
					{#each data.organizations as org (org.slug)}
						<li>
							<a href="/org/{org.slug}/transactions">
								<Icon name="org" class="lead" /><strong>{org.name}</strong>
								<Icon name="chevron" size={16} class="tail" />
							</a>
						</li>
					{/each}
				</ul>
			</section>
		{:else}
			<div class="panel">
				<Empty icon="org" title="No organizations yet">
					{#if data.invitations.length === 0}<p>Ask a member manager to invite you.</p>{/if}
				</Empty>
			</div>
		{/if}

		{#if data.canCreate}
			<section class="panel" aria-labelledby="create-heading">
				<div class="panel__head"><Icon name="plus" size={16} /><h2 id="create-heading">New organization</h2></div>
				<div class="panel__body">
					<form method="POST" action="/orgs?/create" class="form" use:submit={{ reset: true }}>
						<input type="hidden" name="csrf_token" value={data.csrfToken} />
						<div class="form-grid">
							<div class="field">
								<label for="org-name">Name <span class="req" aria-hidden="true">*</span></label>
								<input class="input" id="org-name" name="name" required maxlength="120" />
							</div>
							<div class="field">
								<label for="org-slug">URL identifier <span class="req" aria-hidden="true">*</span></label>
								<input
									class="input"
									id="org-slug"
									name="slug"
									required
									pattern="[a-z0-9-]+"
									placeholder="jakarta"
									aria-describedby="org-slug-hint"
								/>
								<p class="hint" id="org-slug-hint">a–z, 0–9, hyphens; 2–48 characters.</p>
							</div>
						</div>
						<div class="form-actions">
							<button class="btn btn--primary" type="submit"><Icon name="plus" size={16} />Create</button>
						</div>
					</form>
				</div>
			</section>
		{/if}
	</div>
</AccountShell>
