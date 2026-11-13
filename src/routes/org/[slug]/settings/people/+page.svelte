<script lang="ts">
	import { enhance } from '$app/forms';
	import OrgShell from '$lib/components/OrgShell.svelte';
	import SettingsNav from '$lib/components/SettingsNav.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const s = $derived(data.settings);
	const slug = $derived(data.shell.org.slug);
	const canManage = $derived(s.can.members);
</script>

<svelte:head>
	<title>People · {data.shell.org.name}</title>
</svelte:head>

<OrgShell {...data.shell} active="settings">
	<div class="page-head">
		<div>
			<h1>People</h1>
			<p class="lede">
				Membership grants access. Removing it revokes access immediately while keeping attribution on past
				records. A person must sign in with Google once before you can add them.
			</p>
		</div>
	</div>

	<SettingsNav current="people" can={s.can} slug={slug} />

	{#if s.msg}<p class="notice" role="status">{s.msg}</p>{/if}

	{#if canManage}
		<h2>Members</h2>
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
			<h2>Add a member</h2>
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
			<button class="btn btn--primary" type="submit">Grant membership</button>
		</form>

		<h2 class="sub-heading">Pending invitations</h2>
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
							</span>
							{#if invitation.mail_error}<span class="cell__sub">Last error: {invitation.mail_error}</span>{/if}
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
			<h2>Invite by email</h2>
			<p class="hint">
				Delivery stays a local outbox in this build: no email is sent. The invitation is recorded so an operator
				can hand the link over.
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
	{:else}
		<p class="muted">Managing members requires the manage-members permission.</p>
	{/if}
</OrgShell>

<style>
	.row-list { list-style: none; margin: 12px 0 20px; padding: 0; }
	.row-list li { display: flex; flex-wrap: wrap; gap: 10px 16px; justify-content: space-between; align-items: flex-start; padding: 10px 0; border-bottom: 1px solid var(--border); }
	.row-main { min-width: 0; flex: 1; }
	.row-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
	.inline-form { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
	.stack-form { display: flex; flex-direction: column; gap: 12px; margin-top: 16px; max-width: 680px; }
	.stack-form h2 { font-size: 16px; margin: 0; }
	.sub-heading { margin-top: 32px; }
	.form-grid { display: grid; gap: 12px; }
	@media (min-width: 720px) { .form-grid { grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); } }
	.field { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--text-secondary); }
	.hint { margin: 0; font-size: 12px; color: var(--text-secondary); }
</style>
