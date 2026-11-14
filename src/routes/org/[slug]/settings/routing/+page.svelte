<script lang="ts">
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
					<Empty icon="routing" title="No labels mapped" inline>
						<p>Unmapped expenses go to the pocket owner.</p>
					</Empty>
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
									<button class="btn btn--quiet btn--danger btn--sm" type="submit">
										<Icon name="trash" size={14} />Delete<span class="visually-hidden"> mapping {mapping.pattern}</span>
									</button>
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
								<label for="mapping-pattern">Statement label <span class="req" aria-hidden="true">*</span></label>
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
						<div class="form-actions">
							<button class="btn btn--primary" type="submit"><Icon name="plus" size={16} />Map label</button>
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
							<label for="income-role">Income explanation role</label>
							<select class="select" id="income-role" name="income_explanation_role_id">
								<option value="">Pocket owners only</option>
								{#each s.roles as role (role.id)}
									<option value={role.id} selected={role.id === s.incomeExplanationRoleId}>{role.name}</option>
								{/each}
							</select>
						</div>
						<button class="btn" type="submit"><Icon name="check" size={16} />Save</button>
					</form>
				</div>
			</section>
		{/if}
	</div>
</OrgShell>
