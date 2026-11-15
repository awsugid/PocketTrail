<script lang="ts">
	import { Calendar, Popover } from 'bits-ui';
	import { CalendarDate, type DateValue } from '@internationalized/date';
	import { enhanced, onFormReset } from '$lib/controls.svelte';
	import { fmtDate } from '$lib/fmt';
	import Icon from '../Icon.svelte';

	interface Props {
		id: string;
		name: string;
		/** ISO `YYYY-MM-DD`, or '' for none. This exact value is submitted. */
		value?: string;
		required?: boolean;
		clearable?: boolean;
		/** Id of a form elsewhere on the page that this field belongs to. */
		form?: string;
	}

	let { id, name, value = $bindable(''), required = false, clearable = false, form }: Props = $props();
	const initial = value;

	const parse = (iso: string): CalendarDate | undefined => {
		const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
		return match ? new CalendarDate(Number(match[1]), Number(match[2]), Number(match[3])) : undefined;
	};
	let open = $state(false);
	let picked = $state<DateValue | undefined>(parse(value));
	$effect(() => {
		picked = parse(value);
	});
</script>

{#if !enhanced.on}
	<!-- No-JS baseline: the browser's own date control posts the same ISO value. -->
	<input class="input" {id} {name} {form} {required} type="date" bind:value />
{:else}
<span hidden {@attach onFormReset(() => (value = initial))}></span>
<Popover.Root bind:open>
	<Popover.Trigger
		{id}
		data-field={name}
		class="input ui-trigger"
		aria-required={required || undefined}
		onkeydown={(event) => {
			// Optional dates clear from the keyboard; a required date is corrected by picking another.
			if (clearable && value && (event.key === 'Backspace' || event.key === 'Delete')) value = '';
		}}
	>
		<span class="ui-trigger__text" class:muted={!value}>{value ? fmtDate(value) : 'Pick a date'}</span>
		<Icon name="calendar" size={16} class="ui-trigger__caret" />
	</Popover.Trigger>
	<!-- Visually hidden, not type=hidden, so native required validation still applies. -->
	<input class="visually-hidden" tabindex="-1" aria-hidden="true" {name} {form} {value} {required} onfocus={() => document.getElementById(id)?.focus()} />
	<Popover.Portal>
		<Popover.Content class="ui-popover ui-popover--calendar" sideOffset={4} collisionPadding={12} aria-label="Choose a date">
			<Calendar.Root
				type="single"
				bind:value={picked}
				weekdayFormat="short"
				fixedWeeks
				preventDeselect
				onValueChange={(next) => {
					value = next ? next.toString() : '';
					open = false;
				}}
			>
				{#snippet children({ months: shown, weekdays })}
					<Calendar.Header class="ui-cal__head">
						<Calendar.PrevButton class="btn btn--quiet btn--icon btn--sm" aria-label="Previous month"><Icon name="back" size={16} /></Calendar.PrevButton>
						<Calendar.Heading class="ui-cal__title" />
						<Calendar.NextButton class="btn btn--quiet btn--icon btn--sm" aria-label="Next month"><Icon name="next" size={16} /></Calendar.NextButton>
					</Calendar.Header>
					{#each shown as month (month.value.toString())}
						<Calendar.Grid class="ui-cal__grid">
							<Calendar.GridHead>
								<Calendar.GridRow class="ui-cal__row">
									{#each weekdays as day (day)}
										<Calendar.HeadCell class="ui-cal__dow">{day.slice(0, 2)}</Calendar.HeadCell>
									{/each}
								</Calendar.GridRow>
							</Calendar.GridHead>
							<Calendar.GridBody>
								{#each month.weeks as week, index (index)}
									<Calendar.GridRow class="ui-cal__row">
										{#each week as date (date.toString())}
											<Calendar.Cell {date} month={month.value} class="ui-cal__cell">
												<Calendar.Day class="ui-cal__day" />
											</Calendar.Cell>
										{/each}
									</Calendar.GridRow>
								{/each}
							</Calendar.GridBody>
						</Calendar.Grid>
					{/each}
				{/snippet}
			</Calendar.Root>
			{#if clearable && value}
				<button
					class="btn btn--sm btn--quiet"
					type="button"
					onclick={() => {
						value = '';
						open = false;
					}}>Clear</button
				>
			{/if}
		</Popover.Content>
	</Popover.Portal>
</Popover.Root>
{/if}
