<script lang="ts">
	import AccountShell from '$lib/components/AccountShell.svelte';
	import Empty from '$lib/components/Empty.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import PageHead from '$lib/components/PageHead.svelte';
	import { fmtTs } from '$lib/fmt';
	import { guard } from '$lib/forms';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const p = $derived(data.platform);

	const permissionOptions = [
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
	] as const;
</script>

<svelte:head>
	<title>Platform · PocketTrail</title>
</svelte:head>

<AccountShell user={data.user} csrfToken={data.csrfToken} wide>
	<PageHead title="Platform" icon="platform" />

	<div class="stack">
		<section class="panel" aria-labelledby="accounts-heading">
			<div class="panel__head">
				<Icon name="people" size={16} /><h2 id="accounts-heading">Accounts</h2>
				<span class="count">{p.usersFrom}–{p.usersTo} of {p.usersTotal}</span>
			</div>
			<div class="table-scroll">
				<table class="ledger">
					<caption class="visually-hidden">Accounts and platform administration state</caption>
					<thead>
						<tr>
							<th scope="col">Name</th>
							<th scope="col">Email</th>
							<th scope="col">Access</th>
							<th scope="col"><span class="visually-hidden">Change</span></th>
						</tr>
					</thead>
					<tbody>
						{#each p.users as account (account.id)}
							<tr>
								<td class="row-identity">{account.name}</td>
								<td>{account.email}</td>
								<td>
									<span class="badge badge--{account.admin ? 'approved' : 'muted'}">
										{account.admin ? 'Administrator' : 'Member'}
									</span>
								</td>
								<td class="cell--num">
									{#if account.isSelf}
										<span class="muted">You</span>
									{:else}
										<form
											method="POST"
											action="/platform/users/admin"
											use:guard={account.admin
												? {
														confirm: `${account.name} will lose platform administration. Organization access is unchanged.`,
														confirmLabel: 'Revoke administrator'
													}
												: {}}
										>
											<input type="hidden" name="csrf_token" value={data.csrfToken} />
											<input type="hidden" name="user_id" value={account.id} />
											<input type="hidden" name="admin" value={account.admin ? 'false' : 'true'} />
											<button class="btn btn--sm {account.admin ? 'btn--danger' : ''}" type="submit">
												<Icon name={account.admin ? 'close' : 'plus'} size={14} />
												{account.admin ? 'Revoke admin' : 'Make admin'}
											</button>
										</form>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
		{#if p.usersPrev || p.usersNext}
			<nav class="pager" aria-label="Account pages">
				{#if p.usersPrev}<a class="btn" href={p.usersPrev}><Icon name="back" size={16} />Previous</a>{/if}
				{#if p.usersNext}<a class="btn" href={p.usersNext}>Next<Icon name="next" size={16} /></a>{/if}
			</nav>
		{/if}

		<section class="panel" aria-labelledby="templates-heading">
			<div class="panel__head">
				<Icon name="roles" size={16} /><h2 id="templates-heading">Role templates</h2>
				<span class="count">{p.roleTemplates.length}</span>
			</div>
			{#if p.roleTemplates.length > 0}
				<ul class="rows">
					{#each p.roleTemplates as template (template.id)}
						<li>
							<div class="rows__main">
								<strong>{template.name}</strong>
								<span class="rows__sub">{template.labels.join(' · ') || 'No permissions'}</span>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
			<div class="panel__body panel__body--ruled">
				<form method="POST" action="/platform/role-templates" class="form" use:guard>
					<input type="hidden" name="csrf_token" value={data.csrfToken} />
					<div class="field">
						<label for="template-name">New template <span class="req" aria-hidden="true">*</span></label>
						<input class="input" id="template-name" name="name" required maxlength="100" placeholder="Name" />
					</div>
					<fieldset>
						<legend class="visually-hidden">Permissions</legend>
						<div class="checks">
							{#each permissionOptions as [id, label] (id)}
								<label class="check"><input type="checkbox" name="perm" value={id} />{label}</label>
							{/each}
						</div>
					</fieldset>
					<div class="form-actions">
						<button class="btn btn--primary" type="submit"><Icon name="check" size={16} />Save template</button>
					</div>
				</form>
			</div>
		</section>

		<section class="panel" aria-labelledby="orgs-heading">
			<div class="panel__head">
				<Icon name="org" size={16} /><h2 id="orgs-heading">Organizations</h2>
				<span class="count">{p.organizations.length}</span>
			</div>
			<ul class="rows">
				{#each p.organizations as org (org.slug)}
					<li>
						<div class="rows__main">
							<strong>{org.name}</strong>
							<span class="rows__sub">{org.slug} · created {fmtTs(org.created_at)}</span>
						</div>
						<span class="count">{org.members} member{org.members === 1 ? '' : 's'}</span>
					</li>
				{/each}
			</ul>
		</section>

		<section class="panel" aria-labelledby="events-heading">
			<div class="panel__head">
				<Icon name="history" size={16} /><h2 id="events-heading">Audit trail</h2>
				<span class="count">{p.eventsFrom}–{p.eventsTo} of {p.eventsTotal}</span>
			</div>
			{#if p.events.length === 0}
				<Empty icon="history" title="No events yet" inline />
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
									<td>{event.actorName ?? '—'}</td>
									<td>{event.actionLabel}</td>
									<td>{event.targetLabel}</td>
									<td>{event.outcomeLabel}</td>
									<td class="cell--nowrap">{fmtTs(event.createdAt)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</section>
		{#if p.eventsPrev || p.eventsNext}
			<nav class="pager" aria-label="Event pages">
				{#if p.eventsPrev}<a class="btn" href={p.eventsPrev}><Icon name="back" size={16} />Previous</a>{/if}
				{#if p.eventsNext}<a class="btn" href={p.eventsNext}>Next<Icon name="next" size={16} /></a>{/if}
			</nav>
		{/if}
	</div>
</AccountShell>
