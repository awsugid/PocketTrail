<script lang="ts">
	import Empty from '$lib/components/Empty.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import OrgShell from '$lib/components/OrgShell.svelte';
	import PageHead from '$lib/components/PageHead.svelte';
	import SettingsNav from '$lib/components/SettingsNav.svelte';
	import { guard, submit } from '$lib/forms';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const s = $derived(data.settings);
	const slug = $derived(data.shell.org.slug);
</script>

<svelte:head>
	<title>People · {data.shell.org.name}</title>
</svelte:head>

<OrgShell {...data.shell} active="settings">
	<PageHead title="People" icon="people" />
	<SettingsNav current="people" can={s.can} slug={slug} />

	{#if s.msg}<Notice tone="success">{s.msg}</Notice>{/if}

	{#if !s.can.members}
		<Notice tone="warning">Managing members needs the manage-members permission.</Notice>
	{:else}
		<div class="stack">
			<section class="panel" aria-labelledby="members-heading">
				<div class="panel__head">
					<Icon name="people" size={16} /><h2 id="members-heading">Members</h2>
					<span class="count">{s.members.filter((member) => member.active).length} active</span>
				</div>
				<ul class="rows">
					{#each s.members as member (member.id)}
						<li>
							<div class="rows__main">
								<strong>{member.name}</strong>
								<span class="rows__sub">{member.email} · @{member.handle}</span>
							</div>
							{#if !member.active}<span class="badge badge--muted">Revoked</span>{/if}
							<div class="rows__actions">
								<form method="POST" action="?/setRole" class="form form--inline" use:submit>
									<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
									<input type="hidden" name="id" value={member.id} />
									<label class="visually-hidden" for="role-of-{member.id}">Role for {member.name}</label>
									<select class="select" id="role-of-{member.id}" name="role_id" required style="width: auto">
										{#each s.roles as role (role.id)}
											<option value={role.id} selected={role.id === member.roleId}>{role.name}</option>
										{/each}
									</select>
									<button class="btn btn--sm" type="submit"><Icon name="check" size={14} />Save</button>
								</form>
								{#if member.active}
									<form
										method="POST"
										action="?/removeMember"
										use:submit={{
											confirm: `Revoke ${member.name}? Access and notifications end now.`,
											confirmLabel: 'Revoke'
										}}
									>
										<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
										<input type="hidden" name="id" value={member.id} />
										<button class="btn btn--sm btn--danger" type="submit">
											<Icon name="close" size={14} />Revoke<span class="visually-hidden"> access for {member.name}</span>
										</button>
									</form>
								{:else}
									<form method="POST" action="?/restoreMember" use:submit>
										<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
										<input type="hidden" name="id" value={member.id} />
										<button class="btn btn--sm" type="submit">
											<Icon name="check" size={14} />Restore<span class="visually-hidden"> access for {member.name}</span>
										</button>
									</form>
								{/if}
							</div>
						</li>
					{/each}
				</ul>
				<div class="panel__body panel__body--ruled">
					<form method="POST" action="?/addMember" class="form" use:submit={{ reset: true }}>
						<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
						<div class="form-grid">
							<div class="field">
								<label for="member-identity">Email or user id <span class="req" aria-hidden="true">*</span></label>
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
						<div class="form-actions">
							<button class="btn btn--primary" type="submit"><Icon name="plus" size={16} />Add member</button>
						</div>
						<p class="hint">They must have signed in with Google once.</p>
					</form>
				</div>
			</section>

			<section class="panel" aria-labelledby="invitations-heading">
				<div class="panel__head">
					<Icon name="mail" size={16} /><h2 id="invitations-heading">Invitations</h2>
					<span class="count">{s.invitations.length}</span>
				</div>
				{#if s.invitations.length === 0}
					<Empty icon="mail" title="No pending invitations" inline />
				{:else}
					<ul class="rows">
						{#each s.invitations as invitation (invitation.id)}
							<li>
								<div class="rows__main">
									<strong>{invitation.email}</strong>
									<span class="rows__sub">
										Mail {invitation.mail_status ?? 'not sent'} · {invitation.mail_attempts ?? 0} attempts
										{#if invitation.mail_error} · {invitation.mail_error}{/if}
									</span>
								</div>
								<div class="rows__actions">
									<form method="POST" action="/org/{slug}/settings/invitations/{invitation.id}/resend" use:guard>
										<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
										<button class="btn btn--sm" type="submit">
											<Icon name="mail" size={14} />Resend<span class="visually-hidden"> to {invitation.email}</span>
										</button>
									</form>
									<form
										method="POST"
										action="/org/{slug}/settings/invitations/{invitation.id}/revoke"
										use:guard={{
											confirm: `Revoke invite? The link stops working.`,
											confirmLabel: 'Revoke'
										}}
									>
										<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
										<button class="btn btn--sm btn--danger" type="submit">
											<Icon name="close" size={14} />Revoke<span class="visually-hidden"> invitation for {invitation.email}</span>
										</button>
									</form>
								</div>
							</li>
						{/each}
					</ul>
				{/if}
				<div class="panel__body panel__body--ruled">
					<form method="POST" action="/org/{slug}/settings/invitations" class="form" use:guard>
						<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
						<div class="form-grid">
							<div class="field">
								<label for="invite-email">Email <span class="req" aria-hidden="true">*</span></label>
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
						<div class="form-actions">
							<button class="btn" type="submit"><Icon name="mail" size={16} />Invite</button>
						</div>
						<p class="hint">Recorded in the local outbox; no email is sent in this build.</p>
					</form>
				</div>
			</section>
		</div>
	{/if}
</OrgShell>
