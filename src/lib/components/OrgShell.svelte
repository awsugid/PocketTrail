<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import type { Snippet } from 'svelte';
	import Icon, { type IconName } from './Icon.svelte';
	import Topbar from './Topbar.svelte';

	interface Props {
		user: { name: string; email: string; picture: string | null; isPlatformAdmin: boolean };
		org: { slug: string; name: string; notificationsEnabled: boolean; synthetic: boolean };
		organizations: Array<{ slug: string; name: string }>;
		csrfToken: string;
		active: string;
		children: Snippet;
	}

	let { user, org, organizations, csrfToken, active, children }: Props = $props();

	let navOpen = $state(false);
	afterNavigate(() => (navOpen = false));

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
		{ key: 'transactions', label: 'Ledger', path: 'transactions', icon: 'ledger' },
		{ key: 'imports', label: 'Imports', path: 'imports', icon: 'imports' },
		{ key: 'inventory', label: 'Inventory', path: 'inventory', icon: 'inventory' },
		{ key: 'settings', label: 'Settings', path: 'settings', icon: 'settings' }
	];
</script>

<svelte:window onkeydown={onKey} />

<div class="frame">
	<Topbar {user} {csrfToken} {org} {organizations} bind:navOpen />
	<div class="body">
		<nav class="sidebar" id="org-nav" aria-label="Organization" data-open={navOpen ? 'true' : undefined}>
			{#each nav as item (item.key)}
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
		<main class="main" id="main" tabindex="-1">
			<div class="main__inner">
				{@render children()}
			</div>
		</main>
	</div>
</div>
