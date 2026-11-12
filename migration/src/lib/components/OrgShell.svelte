<script lang="ts">
	import type { Snippet } from 'svelte';

	interface ShellUser {
		name: string;
		email: string;
		picture: string | null;
		isPlatformAdmin: boolean;
	}

	interface Props {
		user: ShellUser;
		org: { slug: string; name: string; notificationsEnabled: boolean };
		organizations: Array<{ slug: string; name: string }>;
		csrfToken: string;
		active: string;
		localMode?: boolean;
		children: Snippet;
	}

	let { user, org, organizations, csrfToken, active, localMode = false, children }: Props = $props();

	const initials = $derived(
		user.name
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((part) => part[0]?.toUpperCase() ?? '')
			.join('') || '?'
	);

	let mobileOpen = $state(false);

	const nav = [
		{ key: 'actions', label: 'Actions', href: (slug: string) => `/org/${slug}/actions` },
		{ key: 'transactions', label: 'Ledger', href: (slug: string) => `/org/${slug}/transactions` },
		{ key: 'imports', label: 'Imports', href: (slug: string) => `/org/${slug}/imports` },
		{ key: 'inventory', label: 'Inventory', href: (slug: string) => `/org/${slug}/inventory` },
		{ key: 'settings', label: 'Settings', href: (slug: string) => `/org/${slug}/settings` }
	];

	let picture = $derived(user.picture);
	let photoBroken = $state(false);
	const showPhoto = $derived(picture !== null && !photoBroken);
</script>

<svelte:head>
	<title>{org.name} · PocketTrail</title>
</svelte:head>

<div class="workspace">
	<header class="topbar">
		<button
			class="topbar__menu"
			type="button"
			aria-expanded={mobileOpen}
			aria-controls="org-nav"
			onclick={() => (mobileOpen = !mobileOpen)}
		>
			<span class="visually-hidden">Menu</span>
			<svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18" fill="none">
				<path d="M2 4.5h14M2 9h14M2 13.5h14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
			</svg>
		</button>
		<a class="topbar__brand" href="/orgs">PocketTrail</a>
		<span class="topbar__org" aria-label="Current organization">{org.name}</span>
		<div class="topbar__account">
			<span class="avatar" aria-hidden="true">
				{#if showPhoto}
					<img src={picture} alt="" referrerpolicy="no-referrer" onerror={() => (photoBroken = true)} />
				{/if}
				<span class="avatar__fallback">{initials}</span>
			</span>
			<span class="topbar__name">{user.name}</span>
			<form method="POST" action="/logout">
				<input type="hidden" name="csrf_token" value={csrfToken} />
				<button class="btn btn--quiet" type="submit">Sign out</button>
			</form>
		</div>
	</header>

	<div class="body">
		<nav class="sidebar" id="org-nav" aria-label="Organization" data-open={mobileOpen ? 'true' : undefined}>
			<div class="sidebar__orgs">
				<span class="sidebar__heading">Organizations</span>
				<ul>
					{#each organizations as candidate (candidate.slug)}
						<li>
							<a
								href="/org/{candidate.slug}/transactions"
								aria-current={candidate.slug === org.slug ? 'true' : undefined}
								class="sidebar__org"
							>
								{candidate.name}
							</a>
						</li>
					{/each}
					<li><a class="sidebar__org sidebar__org--muted" href="/orgs">All organizations…</a></li>
				</ul>
			</div>
			<ul class="sidebar__nav">
				{#each nav as item (item.key)}
					<li>
						<a href={item.href(org.slug)} aria-current={active === item.key ? 'page' : undefined}>
							{item.label}
						</a>
					</li>
				{/each}
			</ul>
			{#if user.isPlatformAdmin}
				<ul class="sidebar__nav sidebar__nav--global">
					<li><a href="/platform">Platform admin</a></li>
				</ul>
			{/if}
			{#if localMode}
				<p class="sidebar__mode">Local mode</p>
			{/if}
		</nav>

		<main class="main">
			{@render children()}
		</main>
	</div>
</div>
