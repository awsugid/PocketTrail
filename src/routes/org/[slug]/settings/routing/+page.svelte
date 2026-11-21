<script lang="ts">
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Button } from '$lib/components/ui/button';
	import Combobox from '$lib/components/ui/LabelCombobox.svelte';
	import Select from '$lib/components/ui/FormSelect.svelte';
	import Empty from '$lib/components/Empty.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Notice from '$lib/components/Notice.svelte';
	import OrgShell from '$lib/components/OrgShell.svelte';
	import PageHead from '$lib/components/PageHead.svelte';
	import SettingsNav from '$lib/components/SettingsNav.svelte';
	import { submit } from '$lib/forms';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const s = $derived(data.settings);
	const activeMembers = $derived(s.members.filter((member) => member.active));

	// Known statement labels of the chosen pocket that are not mapped yet. With
	// none, the field is a plain input; the combobox still accepts a new label.
	let pickedPocket = $state('');
	let mappingLabel = $state('');
	const key = (label: string) => label.trim().toLowerCase();
	const knownLabels = $derived.by(() => {
		const mapped = new Set(s.mappings.filter((m) => String(m.pocketId) === pickedPocket).map((m) => key(m.pattern)));
		const labels = s.pockets.find((pocket) => String(pocket.id) === pickedPocket)?.importedLabels ?? [];
		return labels.filter((label) => !mapped.has(key(label)));
	});
</script>

<svelte:head>
	<title>Routing · {data.shell.org.name}</title>
</svelte:head>

<OrgShell {...data.shell} active="settings">
	<PageHead title="Routing" icon="routing" />
	<SettingsNav current="routing" can={s.can} slug={data.shell.org.slug} />

	{#if s.msg}<Notice tone="success">{s.msg}</Notice>{/if}

	<div class="stack">
		{#if s.can.mappings}
			<section class="panel" aria-labelledby="mappings-heading">
				<div class="panel__head">
					<Icon name="routing" size={16} /><h2 id="mappings-heading">Statement labels</h2>
					<span class="count">{s.mappings.length}</span>
				</div>
				{#if s.mappings.length === 0}
					<Empty icon="routing" title="No labels mapped" inline />
				{:else}
					<ul class="rows">
						{#each s.mappings as mapping (mapping.id)}
							<li>
								<div class="rows__main">
									<strong>{mapping.pattern}</strong>
									<span class="rows__sub">
										{mapping.memberName} · {s.pockets.find((p) => p.id === mapping.pocketId)?.name ?? 'Pocket'}
									</span>
								</div>
								<form
									method="POST"
									action="?/deleteMapping"
									use:submit={{
										confirm: `Delete “${mapping.pattern}”? Existing assignments stay.`,
										confirmLabel: 'Delete'
									}}
								>
									<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
									<input type="hidden" name="id" value={mapping.id} />
									<Button class="" type="submit" variant="destructive" size="sm">
										<Icon name="trash" size={14} />Delete<span class="visually-hidden"> mapping {mapping.pattern}</span>
									</Button>
								</form>
							</li>
						{/each}
					</ul>
				{/if}
				<div class="panel__body panel__body--ruled">
					<form method="POST" action="?/addMapping" class="form" use:submit={{ reset: true }}>
						<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
						<div class="form-grid">
							<div class="field">
								<Label for="mapping-pocket">Pocket</Label>
								<Select id="mapping-pocket" name="pocket_id" items={s.pockets.map((pocket) => ({ value: String(pocket.id), label: pocket.name }))} bind:value={pickedPocket} required />
							</div>
							<div class="field">
								<Label for="mapping-pattern">Statement label <span class="req" aria-hidden="true">*</span></Label>
								{#if knownLabels.length > 0}
									<Combobox id="mapping-pattern" name="pattern" options={knownLabels} bind:value={mappingLabel} required maxlength={300} />
								{:else}
									<Input class="" id="mapping-pattern" name="pattern" required maxlength={300} bind:value={mappingLabel} />
								{/if}
							</div>
							<div class="field">
								<Label for="mapping-member">Responsible member</Label>
								<Select id="mapping-member" name="member_id" items={activeMembers.map((member) => ({ value: String(member.id), label: member.invited ? `${member.name} (invited)` : member.name }))} required />
							</div>
						</div>
						<div class="form-actions">
							<Button class="" type="submit" variant="default"><Icon name="plus" size={16} />Map label</Button>
						</div>
					</form>
				</div>
			</section>
		{/if}

		{#if s.can.roles}
			<section class="panel" aria-labelledby="income-heading">
				<div class="panel__head"><Icon name="roles" size={16} /><h2 id="income-heading">Income notes go to</h2></div>
				<div class="panel__body">
					<form method="POST" action="?/saveIncomeRole" class="form form--inline" use:submit>
						<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
						<div class="field">
							<Label for="income-role">Income explanation role</Label>
							<Select id="income-role" name="income_explanation_role_id" items={[{ value: '', label: 'Pocket owners only' }, ...s.roles.map((role) => ({ value: String(role.id), label: role.name }))]} value={String(s.incomeExplanationRoleId ?? "")} />
						</div>
						<Button class="" type="submit" variant="outline"><Icon name="check" size={16} />Save</Button>
					</form>
				</div>
			</section>
		{/if}
	</div>
</OrgShell>
