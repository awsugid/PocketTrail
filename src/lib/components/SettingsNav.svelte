<script lang="ts">
	import Icon, { type IconName } from './Icon.svelte';

	interface Props {
		slug: string;
		current: 'overview' | 'pockets' | 'routing' | 'people' | 'roles' | 'notifications';
		can: { roles: boolean; members: boolean; mappings: boolean; notifications: boolean };
	}

	let { slug, current, can }: Props = $props();

	// On narrow screens the tab row scrolls: keep the current tab visible
	// (also after a resize) and flag hidden overflow so CSS can fade the edges.
	function tabs(nav: HTMLElement, _current?: string) {
		const sync = () => {
			nav.toggleAttribute('data-fade-start', nav.scrollLeft > 1);
			nav.toggleAttribute('data-fade-end', nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 1);
		};
		const reveal = () => {
			const tab = nav.querySelector<HTMLElement>('[aria-current="page"]');
			if (tab) nav.scrollLeft = tab.offsetLeft - nav.clientWidth / 2 + tab.offsetWidth / 2;
			sync();
		};
		const observer = new ResizeObserver(reveal);
		observer.observe(nav);
		nav.addEventListener('scroll', sync, { passive: true });
		return {
			update: reveal,
			destroy() {
				observer.disconnect();
				nav.removeEventListener('scroll', sync);
			}
		};
	}

	const items = $derived(
		(
			[
				{ key: 'overview', label: 'Overview', href: `/org/${slug}/settings`, icon: 'settings', show: true },
				{ key: 'pockets', label: 'Pockets', href: `/org/${slug}/settings/pockets`, icon: 'pocket', show: true },
				{ key: 'routing', label: 'Routing', href: `/org/${slug}/settings/routing`, icon: 'routing', show: can.mappings || can.roles },
				{ key: 'people', label: 'People', href: `/org/${slug}/settings/people`, icon: 'people', show: can.members },
				{ key: 'roles', label: 'Roles', href: `/org/${slug}/settings/roles`, icon: 'roles', show: can.roles },
				{ key: 'notifications', label: 'Notifications', href: `/org/${slug}/settings/notifications`, icon: 'bell', show: can.notifications }
			] satisfies Array<{ key: string; label: string; href: string; icon: IconName; show: boolean }>
		).filter((item) => item.show)
	);
</script>

<nav class="tabs" aria-label="Settings sections" use:tabs={current}>
	{#each items as item (item.key)}
		<a href={item.href} aria-current={current === item.key ? 'page' : undefined}>
			<Icon name={item.icon} size={16} />{item.label}
		</a>
	{/each}
</nav>
