<script lang="ts">
	import { enhance } from '$app/forms';
	import OrgShell from '$lib/components/OrgShell.svelte';
	import SettingsNav from '$lib/components/SettingsNav.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const s = $derived(data.settings);
	const canManage = $derived(s.can.roles);
</script>

<svelte:head>
	<title>Roles · {data.shell.org.name}</title>
</svelte:head>

<OrgShell {...data.shell} active="settings">
	<div class="page-head">
		<div>
			<h1>Roles</h1>
			<p class="lede">
				A working role must include View transactions to open organization pages. Names are unique in this
				organization.
			</p>
		</div>
	</div>

	<SettingsNav current="roles" can={s.can} slug={data.shell.org.slug} />

	{#if s.msg}<p class="notice" role="status">{s.msg}</p>{/if}

	{#if canManage}
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
			<h2>Add a role</h2>
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
			<button class="btn btn--primary" type="submit">Add role</button>
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
	{:else}
		<p class="muted">Editing roles requires the manage-roles permission.</p>
		<ul class="plain-list">
			{#each s.roles as role (role.id)}
				<li>{role.name} — {role.permissions.join(', ') || 'no permissions'}</li>
			{/each}
		</ul>
	{/if}
</OrgShell>

<style>
	.role-form { display: flex; flex-direction: column; gap: 10px; padding: 16px 0; border-bottom: 1px solid var(--border); max-width: 760px; }
	.role-form h2 { font-size: 16px; margin: 0; }
	.perm-set { border: 0; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 6px 18px; }
	.perm-set legend { padding: 0 0 6px; font-size: 13px; font-weight: 600; }
	.check { display: flex; align-items: center; gap: 6px; font-size: 13px; }
	.inline-form { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; margin-top: 20px; font-size: 13px; color: var(--text-secondary); }
	.field { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--text-secondary); }
</style>
