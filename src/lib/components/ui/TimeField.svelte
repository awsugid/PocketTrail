<script lang="ts">
	import { enhanced, onFormReset } from '$lib/controls.svelte';

	interface Props {
		id: string;
		name: string;
		/** 24-hour `HH:MM`, or '' for none. */
		value?: string;
		required?: boolean;
	}

	let { id, name, value = $bindable(''), required = false }: Props = $props();
	const initial = value;

	// Masked text entry: digits only, the colon is inserted after the hour.
	function mask(event: Event & { currentTarget: HTMLInputElement }) {
		const digits = event.currentTarget.value.replace(/\D/g, '').slice(0, 4);
		value = digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits;
		event.currentTarget.value = value;
	}
</script>

{#if !enhanced.on}
	<!-- No-JS baseline: the browser's own time control posts the same field. -->
	<input class="input" {id} {name} {required} type="time" bind:value />
{:else}
	<span hidden {@attach onFormReset(() => (value = initial))}></span>
	<input
		class="input"
		{id}
		{name}
		{required}
		{value}
		oninput={mask}
		inputmode="numeric"
		autocomplete="off"
		maxlength="5"
		placeholder="HH:MM"
		pattern="([01][0-9]|2[0-3]):[0-5][0-9]"
		title="24-hour time, HH:MM"
	/>
{/if}
