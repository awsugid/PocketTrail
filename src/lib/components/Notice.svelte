<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon, { type IconName } from './Icon.svelte';

	interface Props {
		tone?: 'info' | 'success' | 'warning' | 'danger';
		children: Snippet;
	}

	let { tone = 'info', children }: Props = $props();
	const icons: Record<NonNullable<Props['tone']>, IconName> = { info: 'info', success: 'check', warning: 'alert', danger: 'alert' };
</script>

<div class="notice notice--{tone}" role={tone === 'danger' ? 'alert' : 'status'}>
	<Icon name={icons[tone]} size={16} />
	<div>{@render children()}</div>
</div>
