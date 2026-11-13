<script lang="ts">
	import { enhance } from '$app/forms';
	import OrgShell from '$lib/components/OrgShell.svelte';
	import SettingsNav from '$lib/components/SettingsNav.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const s = $derived(data.settings);
	const activeMembers = $derived(s.members.filter((member) => member.active));
</script>

<svelte:head>
	<title>Pockets · {data.shell.org.name}</title>
</svelte:head>

<OrgShell {...data.shell} active="settings">
	<div class="page-head">
		<div>
			<h1>Pockets</h1>
			<p class="lede">One pocket per bank account's ledger. Every pocket needs an active owner.</p>
		</div>
	</div>

	<SettingsNav current="pockets" can={s.can} slug={data.shell.org.slug} />

	{#if s.msg}<p class="notice" role="status">{s.msg}</p>{/if}

	{#if s.pockets.length === 0}
		<p class="muted">No pockets yet.</p>
	{:else}
		<ul class="row-list">
			{#each s.pockets as pocket (pocket.id)}
				<li>
					<div class="row-main">
						<strong>{pocket.name}</strong>
						<span class="cell__sub">Owner: {pocket.ownerName ?? 'None active'}</span>
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
								{#each activeMembers as member (member.id)}
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
			<h2>Add a pocket</h2>
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
						{#each activeMembers as member (member.id)}
							<option value={member.id}>{member.name}</option>
						{/each}
					</select>
				</div>
			</div>
			<button class="btn btn--primary" type="submit">Add pocket</button>
		</form>
	{/if}
</OrgShell>

<style>
	.row-list { list-style: none; margin: 20px 0; padding: 0; }
	.row-list li { display: flex; flex-wrap: wrap; gap: 10px 16px; justify-content: space-between; align-items: flex-start; padding: 10px 0; border-bottom: 1px solid var(--border); }
	.row-main { min-width: 0; flex: 1; }
	.inline-form { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; font-size: 13px; color: var(--text-secondary); }
	.stack-form { display: flex; flex-direction: column; gap: 12px; margin-top: 20px; max-width: 640px; }
	.stack-form h2 { font-size: 16px; margin: 0; }
	.form-grid { display: grid; gap: 12px; }
	@media (min-width: 720px) { .form-grid { grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); } }
	.field { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--text-secondary); }
</style>
