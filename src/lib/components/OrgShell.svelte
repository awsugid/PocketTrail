<script lang="ts">
	import { afterNavigate } from '$app/navigation';
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
	afterNavigate(() => {
		navOpen = false;
		document.cookie = `pt_org_${encodeURIComponent(user.id)}=${encodeURIComponent(org.slug)}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
	});

	// At phone width the sidebar is a drawer: out of the tab order and the
	// accessibility tree while closed; while open, everything behind the scrim is
	// inert so Tab cannot escape to it.
	let narrow = $state(false);
	$effect(() => {
		const query = matchMedia('(max-width: 800px)');
		const sync = () => (narrow = query.matches);
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

<svelte:window onkeydown={onKey} />

<div class="frame">
	<Topbar {user} {csrfToken} {org} {organizations} locked={drawerOpen} bind:navOpen />
	<div class="body">
		<nav class="sidebar" id="org-nav" aria-label="Organization" inert={narrow && !navOpen} data-open={navOpen ? 'true' : undefined}>
			{#each nav.filter((item) => item.key === 'actions' ? (access.actions ?? access.finance) : item.key === 'inventory' ? access.inventory : access.finance) as item (item.key)}
				<a
					href="/org/{org.slug}/{item.path}"
					aria-current={active === item.key ? 'page' : undefined}
					title={item.label}
				>
					<Icon name={item.icon} /><span class="sidebar__label">{item.label}</span>
				</a>
			{/each}
		</nav>
		{#if navOpen}<button class="scrim" type="button" tabindex="-1" aria-label="Close menu" onclick={() => { navOpen = false; document.getElementById('menu-button')?.focus(); }}></button>{/if}
		<main class="main" id="main" tabindex="-1" inert={drawerOpen}>
			<div class="main__inner">
				{@render children()}
			</div>
		</main>
	</div>
</div>
