<script lang="ts">
 import * as Tooltip from '#lib/components/ui/tooltip/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { afterNavigate } from '$app/navigation';
		import { page } from '$app/state';
		import { enhance } from '$app/forms';
		import * as Alert from '#lib/components/ui/alert/index.ts';
		import { X } from '@lucide/svelte';
	import type { Snippet } from 'svelte';
	import Icon, { type IconName } from './Icon.svelte';
	import Topbar from './Topbar.svelte';

	interface Props {
		user: { id: string; name: string; email: string; picture: string | null; isPlatformAdmin: boolean };
		org: { slug: string; name: string; notificationsEnabled: boolean; synthetic: boolean };
		organizations: Array<{ slug: string; name: string }>;
		access: { finance: boolean; inventory: boolean; actions?: boolean };
		csrfToken: string;
		active: string;
		children: Snippet;
	}

	let { user, org, organizations, access, csrfToken, active, children }: Props = $props();

	let navOpen = $state(false);

	afterNavigate(({ shallow, type }) => {
		if (shallow && type === 'goto') return;

		navOpen = false;
		document.cookie = `pt_org_${encodeURIComponent(user.id)}=${encodeURIComponent(org.slug)}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
	});

	// At phone width the sidebar is a drawer: out of the tab order and the
	// accessibility tree while closed; while open, everything behind the scrim is
	// inert so Tab cannot escape to it.
	let narrow = $state(false);
	$effect(() => {
		const query = matchMedia('(max-width: 800px)');
		const sync = () => narrow = query.matches;
		sync();
		query.addEventListener('change', sync);
		return () => query.removeEventListener('change', sync);
	});
	const drawerOpen = $derived(narrow && navOpen);

	// Phone drawer: focus the first link on open; closing (Escape, scrim, link)
	// returns focus to the menu button unless navigation already moved on.
	let wasOpen = false;
	$effect(() => {
		if (navOpen) document.querySelector<HTMLElement>('#org-nav a')?.focus();
		else if (wasOpen && document.activeElement?.closest('#org-nav')) document.getElementById('menu-button')?.focus();
		wasOpen = navOpen;
	});
	function onKey(event: KeyboardEvent) {
		if (event.key !== 'Escape' || !navOpen) return;
		navOpen = false;
		document.getElementById('menu-button')?.focus();
	}

	const nav: Array<{ key: string; label: string; path: string; icon: IconName }> = [
		{ key: 'actions', label: 'Actions', path: 'actions', icon: 'actions' },
		{ key: 'approval', label: 'Approvals', path: 'approval', icon: 'check' },
		{ key: 'transactions', label: 'Ledger', path: 'transactions', icon: 'ledger' },
		{ key: 'purposes', label: 'Purposes', path: 'purposes', icon: 'tag' },
		{ key: 'imports', label: 'Imports', path: 'imports', icon: 'imports' },
		{ key: 'inventory', label: 'Inventory', path: 'inventory', icon: 'inventory' },
		{ key: 'settings', label: 'Settings', path: 'settings', icon: 'settings' }
	];
</script>

<svelte:window onkeydown={onKey}></svelte:window>

<div class="frame">
	<Topbar
		user={user}
		csrfToken={csrfToken}
		org={org}
		organizations={organizations}
		locked={drawerOpen}
		bind:navOpen
	/>

	<div class="body">
		<nav
			class="sidebar"
			id="org-nav"
			aria-label="Organization"
			inert={narrow && !navOpen}
			data-open={navOpen ? 'true' : undefined}
		>
			{#each nav.filter((item) => item.key === 'actions'
				? access.actions ?? access.finance
				: item.key === 'inventory' ? access.inventory : access.finance) as item (item.key)}
				<Tooltip.Provider>
					<Tooltip.Root>
						<Tooltip.Trigger>
							{#snippet child({ props })}
								<a
									{...props}
									href="/org/{org.slug}/{item.path}"
									aria-current={active === item.key ? 'page' : undefined}
								>
					<Icon name={item.icon} /><span class="sidebar__label">{item.label}</span>
				</a>{/snippet}</Tooltip.Trigger><Tooltip.Content>{item.label}</Tooltip.Content></Tooltip.Root></Tooltip.Provider>
			{/each}
		</nav>

		{#if navOpen}
			<Button
				class="scrim"
				type="button"
				tabindex={-1}
				aria-label="Close menu"
				onclick={() => {
					navOpen = false;
					document.getElementById('menu-button')?.focus();
				}}
			/>
		{/if}

		<main
			class="main"
			id="main"
			tabindex="-1"
			inert={drawerOpen}
		><div class="main__inner">
					{#if page.data.showMcpBanner}
						<Alert.Root role="region" aria-labelledby="mcp-announcement-title" class="mb-5 p-4 pr-14">
							<Alert.Title id="mcp-announcement-title">PocketTrail now works with AI assistants</Alert.Title>
							<Alert.Description>
								<p>Connect Claude, Zed or any MCP client to work with your ledger on your behalf — limited to your permissions.</p>
								<Button href="/org/{org.slug}/settings/ai-clients" variant="link" size="sm" class="mt-1 h-auto p-0">Learn more</Button>
							</Alert.Description>
							<form method="POST" action="/org/{org.slug}?/dismissMcp" class="absolute right-2 top-2" use:enhance={() => async ({ update }) => { await update({ navigate: false }); }}>
								<input type="hidden" name="csrf_token" value={csrfToken} />
								<Button type="submit" variant="ghost" size="icon" aria-label="Dismiss"><X size={16} /></Button>
							</form>
						</Alert.Root>
					{/if}
					{@render children()}</div></main>
	</div>
</div>
