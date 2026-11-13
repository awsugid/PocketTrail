<script lang="ts">
	import { enhance } from '$app/forms';
	import OrgShell from '$lib/components/OrgShell.svelte';
	import SettingsNav from '$lib/components/SettingsNav.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const s = $derived(data.settings);
	const activeMembers = $derived(s.members.filter((member) => member.active));
	const canMapping = $derived(s.can.mappings);
	const canIncomeRole = $derived(s.can.roles);
</script>

<svelte:head>
	<title>Routing · {data.shell.org.name}</title>
</svelte:head>

<OrgShell {...data.shell} active="settings">
	<div class="page-head">
		<div>
			<h1>Routing</h1>
			<p class="lede">
				Who gets asked to explain a movement: statement-label mappings for expenses, and the role that owns
				income notes.
			</p>
		</div>
	</div>

	<SettingsNav current="routing" can={s.can} slug={data.shell.org.slug} />

	{#if s.msg}<p class="notice" role="status">{s.msg}</p>{/if}

	{#if canMapping}
		<section class="detail-section" aria-labelledby="mappings-heading">
			<h2 id="mappings-heading">Actor mappings</h2>
			<p class="section-lede">
				A statement label names the member responsible for new expenses in one pocket. Mappings apply to future
				imports only and never rewrite existing assignments.
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
							{#each activeMembers as member (member.id)}
								<option value={member.id}>{member.name}</option>
							{/each}
						</select>
					</div>
				</div>
				<button class="btn btn--primary" type="submit">Save mapping</button>
			</form>
		</section>
	{/if}

	{#if canIncomeRole}
		<section class="detail-section" aria-labelledby="income-heading">
			<h2 id="income-heading">Income routing</h2>
			<p class="section-lede">
				Income notes go to this role instead of unrelated members. Pocket ownership remains the fallback when
				no active member holds it. This scope never grants general ledger or approval access.
			</p>
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
		</section>
	{/if}
</OrgShell>

<style>
	.section-lede { margin: 0 0 14px; max-width: 70ch; color: var(--text-secondary); }
	.row-list { list-style: none; margin: 0 0 20px; padding: 0; }
	.row-list li { display: flex; flex-wrap: wrap; gap: 10px 16px; justify-content: space-between; align-items: flex-start; padding: 10px 0; border-bottom: 1px solid var(--border); }
	.row-main { min-width: 0; flex: 1; }
	.inline-form { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; font-size: 13px; color: var(--text-secondary); }
	.stack-form { display: flex; flex-direction: column; gap: 12px; margin-top: 12px; max-width: 680px; }
	.stack-form h3 { margin: 0; font-size: 15px; }
	.form-grid { display: grid; gap: 12px; }
	@media (min-width: 720px) { .form-grid { grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); } }
	.field { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--text-secondary); }
</style>
