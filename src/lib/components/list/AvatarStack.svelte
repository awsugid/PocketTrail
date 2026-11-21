<script lang="ts">
	import { Tooltip } from 'bits-ui';
	let { members }: { members: { id: number; name: string; picture: string | null }[] } = $props();
	let failed = $state<string[]>([]);
	const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0] ?? '').join('').toUpperCase();
</script>

<div class="avatar-stack">
	<Tooltip.Provider delayDuration={0}>
		{#each members.slice(0, 3) as member (member.id)}
			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard focus exposes member tooltip.) -->
						<span {...props} class="member-avatar" tabindex="0" role="img" aria-label={member.name}>
							{#if member.picture && !failed.includes(member.picture)}
								<img src={member.picture} alt="" referrerpolicy="no-referrer" onerror={() => { if (member.picture) failed = [...failed, member.picture]; }} />
							{:else}{initials(member.name)}{/if}
						</span>
					{/snippet}
				</Tooltip.Trigger>
				<Tooltip.Portal><Tooltip.Content role="tooltip" class="member-tooltip" sideOffset={4}>{member.name}</Tooltip.Content></Tooltip.Portal>
			</Tooltip.Root>
		{/each}
		{#if members.length > 3}
			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard focus exposes remaining member names.) -->
						<span {...props} class="member-avatar member-avatar--more" tabindex="0" role="img" aria-label={members.slice(3).map(member => member.name).join(', ')}>+{members.length - 3}</span>
					{/snippet}
				</Tooltip.Trigger>
				<Tooltip.Portal><Tooltip.Content role="tooltip" class="member-tooltip" sideOffset={4}>{members.slice(3).map(member => member.name).join(', ')}</Tooltip.Content></Tooltip.Portal>
			</Tooltip.Root>
		{:else if members.length === 0}<span class="muted" aria-label="No responsible member">—</span>{/if}
	</Tooltip.Provider>
</div>
