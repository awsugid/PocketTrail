<script lang="ts">
	interface Props {
		slug: string;
		current: 'overview' | 'pockets' | 'routing' | 'people' | 'roles' | 'notifications';
		can: { roles: boolean; members: boolean; mappings: boolean; notifications: boolean };
	}

	let { slug, current, can }: Props = $props();

	const items = $derived(
		[
			{ key: 'overview', label: 'Overview', href: `/org/${slug}/settings`, show: true },
			{ key: 'pockets', label: 'Pockets', href: `/org/${slug}/settings/pockets`, show: true },
			{ key: 'routing', label: 'Routing', href: `/org/${slug}/settings/routing`, show: can.mappings || can.roles },
			{ key: 'people', label: 'People', href: `/org/${slug}/settings/people`, show: can.members },
			{ key: 'roles', label: 'Roles', href: `/org/${slug}/settings/roles`, show: can.roles },
			{
				key: 'notifications',
				label: 'Notifications',
				href: `/org/${slug}/settings/notifications`,
				show: can.notifications
			}
		].filter((item) => item.show)
	);
</script>

<nav class="settings-nav" aria-label="Settings sections">
	{#each items as item (item.key)}
		<a href={item.href} aria-current={current === item.key ? 'page' : undefined}>{item.label}</a>
	{/each}
</nav>

<style>
	.settings-nav {
		display: flex;
		flex-wrap: wrap;
		gap: 6px 16px;
		margin: 20px 0 8px;
		padding: 10px 0;
		border-top: 1px solid var(--border);
		border-bottom: 1px solid var(--border);
		font-size: 13px;
	}
	.settings-nav a {
		color: var(--text-secondary);
		text-decoration: none;
		padding: 2px 0;
	}
	.settings-nav a:hover {
		color: var(--text);
	}
	.settings-nav a[aria-current='page'] {
		color: var(--text);
		font-weight: 600;
		box-shadow: inset 0 -2px 0 var(--accent);
	}
</style>
