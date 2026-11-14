<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import type { Snippet } from 'svelte';
	import Icon, { type IconName } from './Icon.svelte';
	import Topbar from './Topbar.svelte';

	interface Props {
		user: { name: string; email: string; picture: string | null; isPlatformAdmin: boolean };
		org: { slug: string; name: string; notificationsEnabled: boolean };
		organizations: Array<{ slug: string; name: string }>;
		csrfToken: string;
		active: string;
		localMode?: boolean;
		children: Snippet;
	}

	let { user, org, organizations, csrfToken, active, localMode = false, children }: Props = $props();

	let navOpen = $state(false);
	afterNavigate(() => (navOpen = false));

	const nav: Array<{ key: string; label: string; path: string; icon: IconName }> = [
		{ key: 'actions', label: 'Actions', path: 'actions', icon: 'actions' },
		{ key: 'transactions', label: 'Ledger', path: 'transactions', icon: 'ledger' },
		{ key: 'imports', label: 'Imports', path: 'imports', icon: 'imports' },
		{ key: 'inventory', label: 'Inventory', path: 'inventory', icon: 'inventory' },
		{ key: 'settings', label: 'Settings', path: 'settings', icon: 'settings' }
	];
</script>

<svelte:window onkeydown={(event) => event.key === 'Escape' && (navOpen = false)} />

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
			{#if localMode}
				<div class="sidebar__foot"><span class="sidebar__chip">Local data</span></div>
			{/if}
		</nav>
		<main class="main" id="main" tabindex="-1">
			<div class="main__inner">
				{@render children()}
			</div>
		</main>
	</div>
</div>
