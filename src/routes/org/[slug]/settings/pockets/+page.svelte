<script lang="ts">
	import Select from '$lib/components/ui/Select.svelte';
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
								· <span class="muted">Statement labels ({pocket.importedLabels.length}):</span> {pocket.importedLabels.join(', ')}
							{/if}
								</span>
							</div>
							{#if !pocket.ownerName}<span class="badge badge--needs">No owner</span>{/if}
							{#if s.can.mappings}
								<form method="POST" action="?/setPocketOwner" class="form form--inline" use:submit>
									<input type="hidden" name="csrf_token" value={data.shell.csrfToken} />
									<input type="hidden" name="id" value={pocket.id} />
									<label class="visually-hidden" for="owner-{pocket.id}">Owner of {pocket.name}</label>
									<Select id="owner-{pocket.id}" name="owner_membership_id" items={activeMembers.map((member) => ({ value: String(member.id), label: member.name }))} value={String(pocket.ownerMembershipId ?? '')} required auto />
									<button class="btn" type="submit"><Icon name="check" size={16} />Save</button>
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
								<label for="pocket-name">Name <span class="req" aria-hidden="true">*</span></label>
								<input class="input" id="pocket-name" name="name" required maxlength="120" />
							</div>
							<div class="field">
								<label for="pocket-opening">Opening balance (IDR)</label>
								<input class="input" id="pocket-opening" name="opening_balance" inputmode="decimal" value="0" required />
							</div>
							<div class="field">
								<label for="pocket-owner">Owner</label>
								<Select id="pocket-owner" name="owner_membership_id" items={activeMembers.map((member) => ({ value: String(member.id), label: member.name }))} />
							</div>
						</div>
						<div class="form-actions">
							<button class="btn btn--primary" type="submit"><Icon name="plus" size={16} />Add pocket</button>
						</div>
					</form>
				</div>
			</section>
		{/if}
	</div>
</OrgShell>
