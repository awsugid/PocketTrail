<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import OrgShell from '$lib/components/OrgShell.svelte';
	import PageHead from '$lib/components/PageHead.svelte';
	import SettingsNav from '$lib/components/SettingsNav.svelte';
	import { submit } from '$lib/forms';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const s = $derived(data.settings);
</script>

<svelte:head>
	<title>Roles · {data.shell.org.name}</title>
</svelte:head>

<OrgShell {...data.shell} active="settings">
	<PageHead title="Roles" icon="roles" />
	<SettingsNav current="roles" can={s.can} slug={data.shell.org.slug} />

	{#if s.msg}<Notice tone="success">{s.msg}</Notice>{/if}

	{#if !s.can.roles}
		<Notice tone="warning">Editing roles needs the manage-roles permission.</Notice>
		<div class="panel">
			<ul class="rows">
				{#each s.roles as role (role.id)}
					<li>
						<div class="rows__main">
							<strong>{role.name}</strong>
							<span class="rows__sub">{role.permissions.join(', ') || 'No permissions'}</span>
						</div>
					</li>
				{/each}
			</ul>
		</div>
	{:else}
		<div class="stack">
			{#each s.roles as role (role.id)}
				<section class="panel" aria-label={role.name}>
					<div class="panel__body">
						<form method="POST" action="?/updateRole" class="form" use:submit>
							<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
							<input type="hidden" name="id" value={role.id} />
							<div class="field">
								<label for="role-name-{role.id}">Role name</label>
								<input class="input" id="role-name-{role.id}" name="name" value={role.name} required maxlength="100" />
							</div>
							<fieldset>
								<legend class="visually-hidden">Permissions of {role.name}</legend>
								<div class="checks">
									{#each s.permissions as permission (permission.id)}
										<label class="check">
											<input type="checkbox" name="perm" value={permission.id} checked={role.permissions.includes(permission.id)} />
											{permission.label}
										</label>
									{/each}
								</div>
							</fieldset>
							<div class="form-actions">
								<button class="btn" type="submit"><Icon name="check" size={16} />Save<span class="visually-hidden"> {role.name}</span></button>
							</div>
						</form>
					</div>
				</section>
			{/each}

			<section class="panel" aria-labelledby="new-role-heading">
				<div class="panel__head"><Icon name="plus" size={16} /><h2 id="new-role-heading">New role</h2></div>
				<div class="panel__body">
					<form method="POST" action="?/createRole" class="form" use:submit={{ reset: true }}>
						<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
						<div class="field">
							<label for="new-role-name">Name <span class="req" aria-hidden="true">*</span></label>
							<input class="input" id="new-role-name" name="name" required maxlength="100" />
						</div>
						<fieldset>
							<legend class="visually-hidden">Permissions</legend>
							<div class="checks">
								{#each s.permissions as permission (permission.id)}
									<label class="check"><input type="checkbox" name="perm" value={permission.id} />{permission.label}</label>
								{/each}
							</div>
						</fieldset>
						<div class="form-actions">
							<button class="btn btn--primary" type="submit"><Icon name="plus" size={16} />Add role</button>
						</div>
					</form>
				</div>
				{#if s.roleTemplates.length > 0}
					<div class="panel__body panel__body--ruled">
						<form method="POST" action="?/applyTemplate" class="form form--inline" use:submit>
							<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
							<div class="field">
								<label for="template-pick">Copy a platform template</label>
								<select class="select" id="template-pick" name="template_id" required>
									{#each s.roleTemplates as template (template.id)}
										<option value={template.id}>{template.name}</option>
									{/each}
								</select>
							</div>
							<button class="btn" type="submit"><Icon name="plus" size={16} />Add as role</button>
						</form>
					</div>
				{/if}
			</section>
		</div>
	{/if}
</OrgShell>
