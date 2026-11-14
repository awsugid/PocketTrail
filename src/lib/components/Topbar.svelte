<script lang="ts">
	import { guard } from '$lib/forms';
	import { menu } from '$lib/menu';
	import Icon from './Icon.svelte';

	interface Props {
		user: { name: string; email?: string; picture?: string | null; isPlatformAdmin: boolean };
		csrfToken: string;
		org?: { slug: string; name: string; synthetic?: boolean };
		organizations?: Array<{ slug: string; name: string }>;
		/** Bound by OrgShell so the phone menu button can open the sidebar. */
		navOpen?: boolean;
	}

	let { user, csrfToken, org, organizations = [], navOpen = $bindable(false) }: Props = $props();

	// First letter of up to two words; "Alice (fixture)" must not become "A(".
	const initials = $derived(
		user.name
			.split(/\s+/)
			.map((word) => word.match(/\p{L}/u)?.[0] ?? '')
			.filter(Boolean)
			.slice(0, 2)
			.join('')
			.toUpperCase() || '?'
	);

	// The initials always render; the photo fades in only once it has loaded,
	// so a blocked or expired picture never shows a broken-image icon.
	function photo(img: HTMLImageElement) {
		const show = () => (img.naturalWidth > 0 ? img.setAttribute('data-loaded', '') : undefined);
		if (img.complete) show();
		img.addEventListener('load', show);
		return { destroy: () => img.removeEventListener('load', show) };
	}
</script>

<header class="topbar">
	{#if org}
		<button
			id="menu-button"
			class="btn btn--quiet btn--icon menu-button"
			type="button"
			aria-expanded={navOpen}
			aria-controls="org-nav"
			aria-label="Menu"
			onclick={() => (navOpen = !navOpen)}
		>
			<Icon name={navOpen ? 'close' : 'menu'} />
		</button>
	{/if}
	<a class="brand" href="/orgs" aria-label="PocketTrail, all organizations">
		<span class="brand__mark"><Icon name="pocket" size={16} /></span>
		<span class="brand__text">PocketTrail</span>
	</a>

	{#if org}
		<details class="menu" use:menu>
			<summary class="menu__trigger menu__trigger--bordered" aria-label="Switch organization, current: {org.name}">
				<Icon name="org" />
				<span class="menu__label">{org.name}</span>
				<Icon name="caret" size={14} class="caret" />
			</summary>
			<div class="menu__panel">
				{#each organizations as candidate (candidate.slug)}
					<a
						class="menu__item"
						href="/org/{candidate.slug}/transactions"
						aria-current={candidate.slug === org.slug ? 'true' : undefined}
					>
						<span class="menu__label">{candidate.name}</span>
						{#if candidate.slug === org.slug}<Icon name="check" size={16} class="icon--check" />{/if}
					</a>
				{/each}
				<div class="menu__sep"></div>
				<a class="menu__item" href="/orgs"><Icon name="inventory" size={16} />All organizations</a>
			</div>
		</details>
	{/if}

	<span class="topbar__spacer"></span>

	{#if org?.synthetic}
		<span class="badge badge--info topbar__chip" title="Synthetic demo data, not real records"><Icon name="info" size={12} /><span>Synthetic data</span></span>
	{/if}

	<details class="menu" use:menu>
		<summary class="menu__trigger" aria-label="Account: {user.name}">
			<span class="avatar" aria-hidden="true">
				{initials}
				{#if user.picture}
					<img use:photo src={user.picture} alt="" referrerpolicy="no-referrer" />
				{/if}
			</span>
		</summary>
		<div class="menu__panel menu__panel--end">
			<div class="menu__head">
				<strong>{user.name}</strong>
				{#if user.email}<span>{user.email}</span>{/if}
			</div>
			{#if user.isPlatformAdmin}
				<a class="menu__item" href="/platform"><Icon name="platform" size={16} />Platform admin</a>
			{/if}
			<form method="POST" action="/logout" use:guard>
				<input type="hidden" name="csrf_token" value={csrfToken} />
				<button class="menu__item" type="submit"><Icon name="logout" size={16} />Sign out</button>
			</form>
		</div>
	</details>
</header>
