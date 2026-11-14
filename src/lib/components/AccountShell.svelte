<script lang="ts">
	import type { ComponentProps, Snippet } from 'svelte';
	import Topbar from './Topbar.svelte';

	interface Props {
		user: ComponentProps<typeof Topbar>['user'];
		csrfToken: string;
		wide?: boolean;
		children: Snippet;
	}

	let { user, csrfToken, wide = false, children }: Props = $props();
</script>

<div class="frame">
	<Topbar {user} {csrfToken} />
	<main class="main" id="main" tabindex="-1">
		<div class="main__inner" class:main__inner--narrow={!wide}>
			{@render children()}
		</div>
	</main>
</div>
