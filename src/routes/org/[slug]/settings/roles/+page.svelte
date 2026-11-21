<script lang="ts">
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import Checkbox from '#lib/components/ui/LabeledCheckbox.svelte';
	import Select from '#lib/components/ui/FormSelect.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import Notice from '#lib/components/Notice.svelte';
	import OrgShell from '#lib/components/OrgShell.svelte';
	import PageHead from '#lib/components/PageHead.svelte';
	import SettingsNav from '#lib/components/SettingsNav.svelte';
	import { enhanced } from '#lib/controls.svelte.ts';
	import { submit, unsavedGuard } from '#lib/forms.ts';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const s = $derived(data.settings);
	const labelOf = $derived(new Map(s.permissions.map((permission) => [permission.id, permission.label])));

	// The matrix draft: name and granted permissions per role. Save is enabled
	// only while the draft differs from what is stored.
	type Draft = Record<number, { name: string; granted: Record<string, boolean> }>;
	const saved = (): Draft =>
		Object.fromEntries(
			s.roles.map((role) => [role.id, { name: role.name, granted: Object.fromEntries(s.permissions.map((permission) => [permission.id, role.permissions.includes(permission.id)])) }])
		);
	let draft = $state<Draft>(saved());
	$effect(() => {
		draft = saved();
	});
	const dirty = $derived(
		s.roles.some((role) => {
			const row = draft[role.id];
			return !row || row.name !== role.name || s.permissions.some((permission) => row.granted[permission.id] !== role.permissions.includes(permission.id));
		})
	);
</script>

<svelte:head>
	<title>Roles · {data.shell.org.name}</title>
</svelte:head>

<OrgShell {...data.shell} active="settings">
	<PageHead title="Roles" icon="roles" />
	<SettingsNav current="roles" can={s.can} slug={data.shell.org.slug} />

	{#if s.msg}<Notice tone="success">{s.msg}</Notice>{/if}

	{#if !s.can.roles}
		<div class="panel">
			<ul class="rows">
				{#each s.roles as role (role.id)}
					<li>
						<div class="rows__main">
							<strong>{role.name}</strong>
							<span class="rows__sub">{role.permissions.map((id) => labelOf.get(id) ?? id).join(' · ') || 'No permissions'}</span>
						</div>
					</li>
				{/each}
			</ul>
		</div>
	{:else}
		<div class="stack">
			<section class="panel" aria-labelledby="matrix-heading">
				<div class="panel__head"><Icon name="roles" size={16} /><h2 id="matrix-heading">Roles</h2><span class="count">{s.roles.length}</span></div>
				<form method="POST" action="?/saveRoles" use:submit use:unsavedGuard>
					<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
					<div class="table-scroll">
						<table class="ledger matrix">
							<caption class="visually-hidden">Permissions granted by each role</caption>
							<thead>
								<tr>
									<th scope="col">Permission</th>
									{#each s.roles as role (role.id)}
										<th scope="col">
											<Label class="visually-hidden" for="role-name-{role.id}">Name of {role.name}</Label>
											<Input class="" id="role-name-{role.id}" name="name:{role.id}" bind:value={draft[role.id]!.name} required maxlength={100} />
										</th>
									{/each}
								</tr>
							</thead>
							<tbody>
								{#each s.permissions as permission (permission.id)}
									<tr>
										<th scope="row">
											{permission.label}
											{#if permission.id === 'ViewTransactions'}<span class="cell__sub">Not needed for inventory-only roles</span>{/if}
										</th>
										{#each s.roles as role (role.id)}
											<td class="cell--check">
												<Checkbox name="perm:{role.id}" value={permission.id} bind:checked={draft[role.id]!.granted[permission.id]}>
													<span class="visually-hidden">{role.name}: {permission.label}</span>
												</Checkbox>
											</td>
										{/each}
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
					<div class="panel__body panel__body--ruled">
						<div class="form-actions">
							<Button class="" type="submit" disabled={enhanced.on && !dirty} variant="default"><Icon name="check" size={16} />Save</Button>
						</div>
					</div>
				</form>
			</section>

			<section class="panel" aria-labelledby="new-role-heading">
				<div class="panel__head"><Icon name="plus" size={16} /><h2 id="new-role-heading">New role</h2></div>
				<div class="panel__body">
					<form method="POST" action="?/createRole" class="form" use:submit={{ reset: true }}>
						<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
						<div class="field">
							<Label for="new-role-name">Name <span class="req" aria-hidden="true">*</span></Label>
							<Input class="" id="new-role-name" name="name" required maxlength={100} />
						</div>
						<fieldset>
							<legend class="visually-hidden">Permissions</legend>
							<div class="checks">
								{#each s.permissions as permission (permission.id)}
									<Checkbox name="perm" value={permission.id}>{permission.label}</Checkbox>
								{/each}
							</div>
						</fieldset>
						<div class="form-actions">
							<Button class="" type="submit" variant="default"><Icon name="plus" size={16} />Add role</Button>
						</div>
					</form>
				</div>
				{#if s.roleTemplates.length > 0}
					<div class="panel__body panel__body--ruled">
						<form method="POST" action="?/applyTemplate" class="form form--inline" use:submit>
							<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
							<div class="field">
								<Label for="template-pick">Copy a platform template</Label>
								<Select id="template-pick" name="template_id" items={s.roleTemplates.map((template) => ({ value: String(template.id), label: template.name }))} required />
							</div>
							<Button class="" type="submit" variant="outline"><Icon name="plus" size={16} />Add as role</Button>
						</form>
					</div>
				{/if}
			</section>
		</div>
	{/if}
</OrgShell>
