<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';

	// IDR amount field. The "Rp" prefix is a visual affordance only: the value
	// posts exactly as typed (whole IDR or `.` decimals), and the server turns it
	// into minor units.
	let { value = $bindable(''), ...rest }: HTMLInputAttributes & { value?: string } = $props();
</script>

<span class="money-input">
	<span class="money-input__unit" aria-hidden="true">Rp</span>
	<input class="input" inputmode="decimal" autocomplete="off" bind:value {...rest} />
</span>
