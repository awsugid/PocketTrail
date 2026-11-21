<script lang="ts">
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import MoneyInput from '#lib/components/ui/MoneyInput.svelte';
	import Select from '#lib/components/ui/FormSelect.svelte';
	import Empty from '#lib/components/Empty.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import Notice from '#lib/components/Notice.svelte';
	import OrgShell from '#lib/components/OrgShell.svelte';
	import PageHead from '#lib/components/PageHead.svelte';
	import SettingsNav from '#lib/components/SettingsNav.svelte';
	import { submit } from '#lib/forms.ts';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const s = $derived(data.settings);
	// Pocket owners must have joined; invited members cannot own a pocket.
	const activeMembers = $derived(s.members.filter((member) => member.active && !member.invited));
</script>

<svelte:head>
	<title>Pockets · {data.shell.org.name}</title>
</svelte:head>

<OrgShell {...data.shell} active="settings">
	<PageHead title="Pockets" icon="pocket" />
	<SettingsNav current="pockets" can={s.can} slug={data.shell.org.slug} />

	{#if s.msg}<Notice tone="success">{s.msg}</Notice>{/if}

	<div class="stack">
		<section class="panel" aria-label="Pockets">
			{#if s.pockets.length === 0}
				<Empty icon="pocket" title="No pockets yet" inline />
			{:else}
				<ul class="rows">
					{#each s.pockets as pocket (pocket.id)}
						<li>
							<div class="rows__main">
								<strong>{pocket.name}</strong>
								<span class="rows__sub">
									{#if pocket.ownerName}<Icon name="user" size={12} /> {pocket.ownerName}{:else}No active owner{/if}
									{#if pocket.importedLabels.length > 0}
								· <a href="/org/{data.shell.org.slug}/settings/routing">{pocket.importedLabels.length} {pocket.importedLabels.length === 1 ? 'label' : 'labels'}</a>
							{/if}
								</span>
							</div>
							{#if !pocket.ownerName}<span class="badge badge--needs">No owner</span>{/if}
							{#if s.can.mappings}
								<form method="POST" action="?/setPocketOwner" class="form form--inline" use:submit>
									<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
									<input type="hidden" name="id" value={pocket.id} />
									<Label class="visually-hidden" for="owner-{pocket.id}">Owner of {pocket.name}</Label>
									<Select id="owner-{pocket.id}" name="owner_membership_id" items={activeMembers.map((member) => ({ value: String(member.id), label: member.name }))} value={pocket.ownerName ? String(pocket.ownerMembershipId) : ''} required auto />
									<Button class="" type="submit" variant="outline"><Icon name="check" size={16} />Save</Button>
								</form>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		{#if s.can.mappings}
			<section class="panel" aria-labelledby="add-heading">
				<div class="panel__head"><Icon name="plus" size={16} /><h2 id="add-heading">New pocket</h2></div>
				<div class="panel__body">
					<form method="POST" action="?/addPocket" class="form" use:submit={{ reset: true }}>
						<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
						<div class="form-grid">
							<div class="field">
								<Label for="pocket-name">Name <span class="req" aria-hidden="true">*</span></Label>
								<Input class="" id="pocket-name" name="name" required maxlength={120} />
							</div>
							<div class="field">
								<Label for="pocket-opening">Opening balance (IDR)</Label>
								<MoneyInput id="pocket-opening" name="opening_balance" value="0" required />
							</div>
							<div class="field">
								<Label for="pocket-owner">Owner</Label>
								<Select id="pocket-owner" name="owner_membership_id" items={activeMembers.map((member) => ({ value: String(member.id), label: member.name }))} value={String(s.defaultOwnerId ?? '')} required />
							</div>
						</div>
						<div class="form-actions">
							<Button class="" type="submit" variant="default"><Icon name="plus" size={16} />Add pocket</Button>
						</div>
					</form>
				</div>
			</section>
		{/if}
	</div>
</OrgShell>
