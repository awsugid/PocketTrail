<script lang="ts">
	import { fmtTs } from '$lib/fmt';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const p = $derived(data.platform);
</script>

<svelte:head>
	<title>Platform administration · PocketTrail</title>
</svelte:head>

<header class="masthead">
	<span class="masthead__org-name">PocketTrail</span>
	<nav class="masthead__nav" aria-label="Account">
		<span class="muted">{data.user.name}</span>
		<a href="/orgs">Organizations</a>
		<form method="POST" action="/logout">
			<input type="hidden" name="csrf_token" value={data.csrfToken} />
			<button class="btn btn--quiet" type="submit">Sign out</button>
		</form>
	</nav>
</header>

<div class="page-head">
	<div>
		<h1>Platform administration</h1>
		<p class="lede">
			Accounts, shared role templates, and the global audit trail. Administration here grants no access
			to any organization's financial records.
		</p>
	</div>
</div>

<section class="admin-section" aria-labelledby="accounts-heading">
	<h2 id="accounts-heading">Accounts</h2>
	<p class="muted">
		Showing {p.usersFrom}–{p.usersTo} of {p.usersTotal} of {p.usersPages} page{p.usersPages === 1 ? '' : 's'}.
	</p>
	<div class="table-scroll">
		<table class="ledger">
			<caption class="visually-hidden">Accounts and platform administration state</caption>
			<thead>
				<tr>
					<th scope="col">Name</th>
					<th scope="col">Email</th>
					<th scope="col">Platform access</th>
					<th scope="col">Change</th>
				</tr>
			</thead>
			<tbody>
				{#each p.users as account (account.id)}
					<tr>
						<td class="row-identity" data-label="Name">{account.name}</td>
						<td data-label="Email">{account.email}</td>
						<td data-label="Platform access">
							<span class="badge badge--{account.admin ? 'approved' : 'muted'}">
								{account.admin ? 'Administrator' : 'Member'}
							</span>
						</td>
						<td data-label="Change">
							{#if account.isSelf}
								<span class="muted">Ask another administrator to change your access.</span>
							{:else}
								<form method="POST" action="/platform/users/admin" class="inline-form">
									<input type="hidden" name="csrf_token" value={data.csrfToken} />
									<input type="hidden" name="user_id" value={account.id} />
									<input type="hidden" name="admin" value={account.admin ? 'false' : 'true'} />
									<button class="btn" type="submit">
										{account.admin ? 'Revoke administrator' : 'Grant administrator'}
									</button>
								</form>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	{#if p.usersPrev || p.usersNext}
		<nav class="pager" aria-label="Account pages">
			{#if p.usersPrev}<a class="btn" href={p.usersPrev}>Previous accounts</a>{/if}
			{#if p.usersNext}<a class="btn" href={p.usersNext}>Next accounts</a>{/if}
		</nav>
	{/if}
</section>

<section class="admin-section" aria-labelledby="templates-heading">
	<h2 id="templates-heading">Role templates</h2>
	<p class="section-lede">
		Organizations can copy a template as their own role. A copy never changes when the template does.
	</p>
	{#if p.roleTemplates.length > 0}
		<ul class="row-list">
			{#each p.roleTemplates as template (template.id)}
				<li>
					<div class="row-main">
						<strong>{template.name}</strong>
						<span class="cell__sub">{template.labels.join(' · ') || 'No permissions'}</span>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
	<form method="POST" action="/platform/role-templates" class="stack-form">
		<input type="hidden" name="csrf_token" value={data.csrfToken} />
		<h3>Save a template</h3>
		<div class="field">
			<label for="template-name">Name</label>
			<input class="input" id="template-name" name="name" required maxlength="100" />
		</div>
		<fieldset class="perm-set">
			<legend>Permissions</legend>
			{#each [
				['ViewTransactions', 'View transactions'],
				['CommentTransactions', 'Comment on transactions'],
				['DocumentTransactions', 'Document transactions'],
				['ApproveTransactions', 'Approve or request changes'],
				['ImportStatements', 'Import statements'],
				['ManageRoles', 'Manage roles'],
				['ManageMembers', 'Manage members'],
				['ManageNotifications', 'Manage notifications'],
				['SuppressNotifications', 'Suppress notifications'],
				['UpdateStock', 'Update stock']
			] as permission (permission[0])}
				<label class="check">
					<input type="checkbox" name="perm" value={permission[0]} />
					{permission[1]}
				</label>
			{/each}
		</fieldset>
		<button class="btn btn--primary" type="submit">Save template</button>
	</form>
</section>

<section class="admin-section" aria-labelledby="orgs-heading">
	<h2 id="orgs-heading">Organizations</h2>
	<p class="muted">Names only; financial records stay behind organization membership.</p>
	<ul class="plain-list">
		{#each p.organizations as org (org.slug)}
			<li>
				{org.name} <span class="cell__sub">{org.slug} · {org.members} active member{org.members === 1 ? '' : 's'} · created {fmtTs(org.created_at)}</span>
			</li>
		{/each}
	</ul>
</section>

<section class="admin-section" aria-labelledby="events-heading">
	<h2 id="events-heading">Global audit trail</h2>
	<p class="muted">
		Showing {p.eventsFrom}–{p.eventsTo} of {p.eventsTotal} of {p.eventsPages} page{p.eventsPages === 1 ? '' : 's'}.
	</p>
	{#if p.events.length === 0}
		<p class="muted">No platform events recorded yet.</p>
	{:else}
		<div class="table-scroll">
			<table class="ledger">
				<caption class="visually-hidden">Platform events, newest first</caption>
				<thead>
					<tr>
						<th scope="col">Actor</th>
						<th scope="col">Action</th>
						<th scope="col">Target</th>
						<th scope="col">Outcome</th>
						<th scope="col">When</th>
					</tr>
				</thead>
				<tbody>
					{#each p.events as event (event.id)}
						<tr>
							<td data-label="Actor">{event.actorName ?? '—'}</td>
							<td data-label="Action">{event.actionLabel}</td>
							<td data-label="Target">{event.targetLabel}</td>
							<td data-label="Outcome">{event.outcomeLabel}</td>
							<td class="cell--nowrap" data-label="When">{fmtTs(event.createdAt)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
	{#if p.eventsPrev || p.eventsNext}
		<nav class="pager" aria-label="Event pages">
			{#if p.eventsPrev}<a class="btn" href={p.eventsPrev}>Previous events</a>{/if}
			{#if p.eventsNext}<a class="btn" href={p.eventsNext}>Next events</a>{/if}
		</nav>
	{/if}
</section>

<style>
	.admin-section {
		margin-top: 32px;
		max-width: 1000px;
	}
	.section-lede {
		margin: 0 0 12px;
		max-width: 70ch;
		color: var(--text-secondary);
	}
	.row-list {
		list-style: none;
		margin: 0 0 16px;
		padding: 0;
	}
	.row-list li {
		padding: 10px 0;
		border-bottom: 1px solid var(--border);
	}
	.stack-form {
		display: flex;
		flex-direction: column;
		gap: 12px;
		margin-top: 12px;
		max-width: 640px;
	}
	.stack-form h3 {
		margin: 0;
		font-size: 15px;
	}
	.perm-set {
		border: 0;
		padding: 0;
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 6px 18px;
	}
	.perm-set legend {
		padding: 0 0 6px;
		font-size: 13px;
		font-weight: 600;
	}
	.check {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 13px;
	}
	.inline-form {
		display: inline-flex;
		gap: 8px;
		align-items: center;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 13px;
		color: var(--text-secondary);
	}
</style>
