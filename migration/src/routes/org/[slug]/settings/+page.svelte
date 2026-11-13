<script lang="ts">
	import { enhance } from '$app/forms';
	import OrgShell from '$lib/components/OrgShell.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const s = $derived(data.settings);
	const slug = $derived(data.shell.org.slug);
	const base = $derived(`/org/${slug}/settings`);
	const outboxAvailable = $derived(s.notifications.enabled);
</script>

<svelte:head>
	<title>Settings · {data.shell.org.name}</title>
</svelte:head>

<OrgShell {...data.shell} active="settings">
	<div class="page-head">
		<div>
			<h1>Settings</h1>
			<p class="lede">
				Pockets, routing, people, roles, and notifications for {data.shell.org.name}. Each section saves on
				its own and re-checks your permission.
			</p>
		</div>
	</div>

	{#if s.msg}<p class="notice" role="status">{s.msg}</p>{/if}

	<nav class="section-nav" aria-label="Settings sections">
		<a href="#pockets">Pockets</a>
		{#if s.can.mappings}<a href="#mappings">Actor mappings</a>{/if}
		{#if s.can.members}<a href="#people">People</a>{/if}
		{#if s.can.roles}<a href="#roles">Roles</a>{/if}
		{#if s.can.notifications}<a href="#notifications">Notifications</a>{/if}
		{#if s.can.members}<a href="#audit">Audit trail</a>{/if}
	</nav>

	<!-- ------------------------------------------------------------ pockets -->
	<section class="settings-section" id="pockets" aria-labelledby="pockets-heading">
		<h2 id="pockets-heading">Pockets</h2>
		<p class="section-lede">A pocket is one bank account's ledger. Every pocket needs an active owner.</p>

		{#if s.pockets.length === 0}
			<p class="muted">No pockets yet.</p>
		{:else}
			<ul class="row-list">
				{#each s.pockets as pocket (pocket.id)}
					<li>
						<div class="row-main">
							<strong>{pocket.name}</strong>
							<span class="cell__sub">
								Owner: {pocket.ownerName ?? 'None active'} · Opening balance:
								{(pocket.openingBalanceMinor / 100).toLocaleString('id-ID')} IDR
							</span>
							{#if pocket.importedLabels.length > 0}
								<span class="cell__sub">Statement labels: {pocket.importedLabels.join(', ')}</span>
							{/if}
						</div>
						{#if s.can.mappings}
							<form method="POST" action="?/setPocketOwner" use:enhance class="inline-form">
								<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
								<input type="hidden" name="id" value={pocket.id} />
								<label class="visually-hidden" for="owner-{pocket.id}">Pocket owner</label>
								<select class="select" id="owner-{pocket.id}" name="owner_membership_id" required>
									{#each s.members.filter((m) => m.active) as member (member.id)}
										<option value={member.id} selected={member.id === pocket.ownerMembershipId}>{member.name}</option>
									{/each}
								</select>
								<button class="btn" type="submit">Save owner</button>
							</form>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}

		{#if s.can.mappings}
			<form method="POST" action="?/addPocket" use:enhance class="stack-form">
				<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
				<h3>Add a pocket</h3>
				<div class="form-grid">
					<div class="field">
						<label for="pocket-name">Name</label>
						<input class="input" id="pocket-name" name="name" required maxlength="120" />
					</div>
					<div class="field">
						<label for="pocket-opening">Opening balance (IDR)</label>
						<input class="input" id="pocket-opening" name="opening_balance" inputmode="decimal" value="0" required />
					</div>
					<div class="field">
						<label for="pocket-owner">Owner</label>
						<select class="select" id="pocket-owner" name="owner_membership_id">
							{#each s.members.filter((m) => m.active) as member (member.id)}
								<option value={member.id}>{member.name}</option>
							{/each}
						</select>
					</div>
				</div>
				<button class="btn" type="submit">Add pocket</button>
			</form>
		{/if}
	</section>

	<!-- ----------------------------------------------------------- mappings -->
	{#if s.can.mappings}
		<section class="settings-section" id="mappings" aria-labelledby="mappings-heading">
			<h2 id="mappings-heading">Actor mappings</h2>
			<p class="section-lede">
				A statement label can name the member responsible for new expenses. Mappings apply to future imports only
				and never rewrite existing assignments.
			</p>
			{#if s.mappings.length === 0}
				<p class="muted">No mappings yet. Unmapped expenses fall back to the pocket owner.</p>
			{:else}
				<ul class="row-list">
					{#each s.mappings as mapping (mapping.id)}
						<li>
							<div class="row-main">
								<strong>{mapping.pattern}</strong>
								<span class="cell__sub">
									{mapping.memberName} · {s.pockets.find((p) => p.id === mapping.pocketId)?.name ?? 'Pocket'}
								</span>
							</div>
							<form method="POST" action="?/deleteMapping" use:enhance>
								<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
								<input type="hidden" name="id" value={mapping.id} />
								<button class="btn btn--quiet" type="submit">Remove</button>
							</form>
						</li>
					{/each}
				</ul>
			{/if}

			<form method="POST" action="?/addMapping" use:enhance class="stack-form">
				<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
				<h3>Map a statement label</h3>
				<div class="form-grid">
					<div class="field">
						<label for="mapping-pattern">Statement label</label>
						<input class="input" id="mapping-pattern" name="pattern" required maxlength="300" />
					</div>
					<div class="field">
						<label for="mapping-pocket">Pocket</label>
						<select class="select" id="mapping-pocket" name="pocket_id" required>
							{#each s.pockets as pocket (pocket.id)}
								<option value={pocket.id}>{pocket.name}</option>
							{/each}
						</select>
					</div>
					<div class="field">
						<label for="mapping-member">Responsible member</label>
						<select class="select" id="mapping-member" name="member_id" required>
							{#each s.members.filter((m) => m.active) as member (member.id)}
								<option value={member.id}>{member.name}</option>
							{/each}
						</select>
					</div>
				</div>
				<button class="btn" type="submit">Save mapping</button>
			</form>
		</section>
	{/if}

	<!-- ------------------------------------------------------------- people -->
	{#if s.can.members}
		<section class="settings-section" id="people" aria-labelledby="people-heading">
			<h2 id="people-heading">People</h2>
			<p class="section-lede">
				Membership grants access; removing it revokes access immediately while keeping attribution on past records.
				A person must sign in with Google once before you can add them.
			</p>

			<ul class="row-list">
				{#each s.members as member (member.id)}
					<li>
						<div class="row-main">
							<strong>{member.name}</strong>
							<span class="cell__sub">{member.email} · @{member.handle}</span>
							<span class="cell__sub">{member.active ? 'Active' : 'Access revoked'}</span>
						</div>
						<div class="row-actions">
							<form method="POST" action="?/setRole" use:enhance class="inline-form">
								<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
								<input type="hidden" name="id" value={member.id} />
								<label class="visually-hidden" for="role-of-{member.id}">Role for {member.name}</label>
								<select class="select" id="role-of-{member.id}" name="role_id" required>
									{#each s.roles as role (role.id)}
										<option value={role.id} selected={role.id === member.roleId}>{role.name}</option>
									{/each}
								</select>
								<button class="btn" type="submit">Save role</button>
							</form>
							{#if member.active}
								<form method="POST" action="?/removeMember" use:enhance>
									<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
									<input type="hidden" name="id" value={member.id} />
									<button class="btn btn--quiet" type="submit">Revoke access</button>
								</form>
							{:else}
								<form method="POST" action="?/restoreMember" use:enhance>
									<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
									<input type="hidden" name="id" value={member.id} />
									<button class="btn" type="submit">Restore access</button>
								</form>
							{/if}
						</div>
					</li>
				{/each}
			</ul>

			<form method="POST" action="?/addMember" use:enhance class="stack-form">
				<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
				<h3>Add a member</h3>
				<div class="form-grid">
					<div class="field">
						<label for="member-identity">Email or user id</label>
						<input class="input" id="member-identity" name="user_id" required />
					</div>
					<div class="field">
						<label for="member-role">Role</label>
						<select class="select" id="member-role" name="role_id" required>
							{#each s.roles as role (role.id)}
								<option value={role.id}>{role.name}</option>
							{/each}
						</select>
					</div>
				</div>
				<button class="btn" type="submit">Grant membership</button>
			</form>

			<h3 class="sub-heading">Pending invitations</h3>
			{#if s.invitations.length === 0}
				<p class="muted">No pending invitations.</p>
			{:else}
				<ul class="row-list">
					{#each s.invitations as invitation (invitation.id)}
						<li>
							<div class="row-main">
								<strong>{invitation.email}</strong>
								<span class="cell__sub">
									Mail: {invitation.mail_status ?? 'not sent'} · attempts {invitation.mail_attempts ?? 0}
									{#if invitation.mail_error}<span class="cell__sub">Last error: {invitation.mail_error}</span>{/if}
								</span>
							</div>
							<div class="row-actions">
								<form method="POST" action="/org/{slug}/settings/invitations/{invitation.id}/resend">
									<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
									<button class="btn btn--quiet" type="submit">Resend</button>
								</form>
								<form method="POST" action="/org/{slug}/settings/invitations/{invitation.id}/revoke">
									<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
									<button class="btn btn--quiet" type="submit">Revoke</button>
								</form>
							</div>
						</li>
					{/each}
				</ul>
			{/if}

			<form method="POST" action="/org/{slug}/settings/invitations" class="stack-form">
				<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
				<h3>Invite by email</h3>
				<p class="hint">
					Delivery stays a local outbox in this build: no email is sent. The invitation link is recorded so an
					operator can hand it over.
				</p>
				<div class="form-grid">
					<div class="field">
						<label for="invite-email">Email</label>
						<input class="input" id="invite-email" name="email" type="email" required />
					</div>
					<div class="field">
						<label for="invite-role">Role</label>
						<select class="select" id="invite-role" name="role_id" required>
							{#each s.roles as role (role.id)}
								<option value={role.id}>{role.name}</option>
							{/each}
						</select>
					</div>
				</div>
				<button class="btn" type="submit">Create invitation</button>
			</form>
		</section>
	{/if}

	<!-- -------------------------------------------------------------- roles -->
	{#if s.can.roles}
		<section class="settings-section" id="roles" aria-labelledby="roles-heading">
			<h2 id="roles-heading">Roles</h2>
			<p class="section-lede">
				A working role must include View transactions to open organization pages. Names are unique in this
				organization.
			</p>

			{#each s.roles as role (role.id)}
				<form method="POST" action="?/updateRole" use:enhance class="role-form">
					<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
					<input type="hidden" name="id" value={role.id} />
					<div class="field">
						<label for="role-name-{role.id}">Role name</label>
						<input class="input" id="role-name-{role.id}" name="name" value={role.name} required maxlength="100" />
					</div>
					<fieldset class="perm-set">
						<legend>Permissions</legend>
						{#each s.permissions as permission (permission.id)}
							<label class="check">
								<input type="checkbox" name="perm" value={permission.id} checked={role.permissions.includes(permission.id)} />
								{permission.label}
							</label>
						{/each}
					</fieldset>
					<button class="btn" type="submit">Save {role.name}</button>
				</form>
			{/each}

			<form method="POST" action="?/createRole" use:enhance class="role-form">
				<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
				<h3>Add a role</h3>
				<div class="field">
					<label for="new-role-name">Name</label>
					<input class="input" id="new-role-name" name="name" required maxlength="100" />
				</div>
				<fieldset class="perm-set">
					<legend>Permissions</legend>
					{#each s.permissions as permission (permission.id)}
						<label class="check">
							<input type="checkbox" name="perm" value={permission.id} />
							{permission.label}
						</label>
					{/each}
				</fieldset>
				<button class="btn" type="submit">Add role</button>
			</form>

			{#if s.roleTemplates.length > 0}
				<form method="POST" action="?/applyTemplate" use:enhance class="inline-form">
					<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
					<label for="template-pick">Copy a platform role template</label>
					<select class="select" id="template-pick" name="template_id" required>
						{#each s.roleTemplates as template (template.id)}
							<option value={template.id}>{template.name}</option>
						{/each}
					</select>
					<button class="btn" type="submit">Add as role</button>
				</form>
			{/if}

			<h3 class="sub-heading">Income routing</h3>
			<form method="POST" action="?/saveIncomeRole" use:enhance class="inline-form">
				<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
				<label for="income-role">Income explanation role</label>
				<select class="select" id="income-role" name="income_explanation_role_id">
					<option value="">No income role (pocket owners only)</option>
					{#each s.roles as role (role.id)}
						<option value={role.id} selected={role.id === s.incomeExplanationRoleId}>{role.name}</option>
					{/each}
				</select>
				<button class="btn" type="submit">Save routing</button>
			</form>
			<p class="hint">
				Income notes go to this role instead of unrelated members. Pocket ownership remains the fallback when no
				active member holds it.
			</p>
		</section>
	{/if}

	<!-- ------------------------------------------------------ notifications -->
	{#if s.can.notifications}
		<section class="settings-section" id="notifications" aria-labelledby="notifications-heading">
			<h2 id="notifications-heading">Notifications</h2>
			<p class="section-lede">
				Off by default. When on, messages are captured in a local outbox only — this build sends no email and runs no
				scheduler. Enabling never releases messages queued while disabled.
			</p>

			<form method="GET" action={base} class="inline-form">
				<label for="cutoff">Transaction-date cutoff</label>
				<input class="input" id="cutoff" name="cutoff_date" type="date" value={s.notificationPreviewCutoff} required />
				<button class="btn" type="submit">Preview recipients</button>
			</form>

			{#if s.notificationPreview}
				<div class="preview">
					<p>
						{s.notificationPreview.recipients.length} recipient{s.notificationPreview.recipients.length === 1 ? '' : 's'}
						at cutoff <strong>{s.notificationPreviewCutoff}</strong>: {s.notificationPreview.totalItems} documentation
						item{s.notificationPreview.totalItems === 1 ? '' : 's'} pending.
						{#if s.notificationPreview.limited}
							<span class="muted">Scan limited to the most recent 500 movements.</span>
						{/if}
					</p>
					{#if s.notificationPreview.recipients.length > 0}
						<ul class="plain-list">
							{#each s.notificationPreview.recipients as recipient (recipient.name)}
								<li>{recipient.name}: {recipient.pending} pending</li>
							{/each}
						</ul>
					{:else}
						<p class="muted">Nobody has documentation pending at this cutoff.</p>
					{/if}
				</div>
			{/if}

			<form method="POST" action="?/saveNotifications" use:enhance class="stack-form">
				<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
				<input type="hidden" name="preview_token" value={s.previewToken} />
				<label class="check">
					<input type="checkbox" name="enabled" checked={s.notifications.enabled} /> Enable organization notifications
				</label>
				<div class="field">
					<label for="cutoff-save">Transaction-date cutoff</label>
					<input class="input" id="cutoff-save" name="cutoff_date" type="date"
						value={s.notifications.cutoffDate ?? ''} />
					<p class="hint">Preview recipients for this cutoff before enabling; a stale preview is rejected.</p>
				</div>
				<button class="btn" type="submit">Save notification settings</button>
			</form>

			<form method="POST" action="/org/{slug}/notifications/digest">
				<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
				<button class="btn" type="submit" disabled={!s.notifications.enabled}>Capture weekly digests now</button>
			</form>

			<h3 class="sub-heading">Local outbox</h3>
			{#if !outboxAvailable}
				<p class="muted">Notifications are disabled; nothing is deliverable.</p>
			{:else if s.outbox.length === 0}
				<p class="muted">No deliverable messages are queued.</p>
			{:else}
				<div class="table-scroll">
					<table class="ledger">
						<caption class="visually-hidden">Queued notifications, newest first</caption>
						<thead>
							<tr>
								<th scope="col">Kind</th>
								<th scope="col">To</th>
								<th scope="col">Subject</th>
								<th scope="col">Queued</th>
							</tr>
						</thead>
						<tbody>
							{#each s.outbox as row (row.createdAtLabel + row.subject + row.toName)}
								<tr>
									<td data-label="Kind">{row.kind}</td>
									<td data-label="To">{row.toName}</td>
									<td data-label="Subject">{row.subject}</td>
									<td class="cell--nowrap" data-label="Queued">{row.createdAtLabel}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</section>
	{/if}

	<!-- --------------------------------------------------------- audit trail -->
	{#if s.can.members}
		<section class="settings-section" id="audit" aria-labelledby="audit-heading">
			<h2 id="audit-heading">Audit trail</h2>
			<p class="section-lede">Append-only record of organization changes, newest first.</p>
			{#if s.auditEvents.length === 0}
				<p class="muted">No organization events recorded yet.</p>
			{:else}
				<ul class="row-list">
					{#each s.auditEvents as event (event.id)}
						<li>
							<div class="row-main">
								<strong>{event.actionLabel}</strong>
								<span class="cell__sub">
									{event.actorName ?? 'Unknown actor'} · {event.targetLabel} · {event.outcomeLabel} · {event.createdAtLabel}
								</span>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
			{#if s.auditPage > 1 || s.auditHasMore}
				<nav class="pager" aria-label="Audit pages">
					{#if s.auditPage > 1}
						<a class="btn" href="{base}?page={s.auditPage - 1}#audit">Newer</a>
					{/if}
					{#if s.auditHasMore}
						<a class="btn" href="{base}?page={s.auditPage + 1}#audit">Older</a>
					{/if}
				</nav>
			{/if}
		</section>
	{/if}
</OrgShell>

<style>
	.section-nav {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 16px;
		margin: 20px 0 4px;
		padding: 10px 0;
		border-top: 1px solid var(--border);
		border-bottom: 1px solid var(--border);
		font-size: 13px;
	}
	.settings-section {
		margin-top: 32px;
		max-width: 900px;
	}
	.section-lede {
		margin: 0 0 14px;
		max-width: 70ch;
		color: var(--text-secondary);
	}
	.sub-heading {
		margin: 28px 0 8px;
		font-size: 15px;
	}
	.row-list {
		list-style: none;
		margin: 0 0 20px;
		padding: 0;
	}
	.row-list li {
		display: flex;
		flex-wrap: wrap;
		gap: 10px 16px;
		justify-content: space-between;
		align-items: flex-start;
		padding: 10px 0;
		border-bottom: 1px solid var(--border);
	}
	.row-main {
		min-width: 0;
		flex: 1;
	}
	.row-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		align-items: center;
	}
	.inline-form {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 12px;
		align-items: center;
		font-size: 13px;
		color: var(--text-secondary);
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
	.form-grid {
		display: grid;
		gap: 12px;
	}
	@media (min-width: 720px) {
		.form-grid {
			grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		}
	}
	.role-form {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 16px 0;
		border-bottom: 1px solid var(--border);
		max-width: 720px;
	}
	.role-form h3 {
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
	.field {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 13px;
		color: var(--text-secondary);
	}
	.hint {
		margin: 4px 0 0;
		font-size: 12px;
		color: var(--text-secondary);
	}
	.preview {
		margin: 12px 0;
		padding: 10px 12px;
		background: var(--surface-2);
		border-radius: var(--radius-control);
		max-width: 640px;
	}
	.preview p {
		margin: 0 0 6px;
	}
</style>
