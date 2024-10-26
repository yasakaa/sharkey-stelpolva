<!--
SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.tabstrip">
	<button
		v-for="tab of tabs"
		:key="tab.key"
		:disabled="modelValue === tab.key"
		:class="{ [$style.button]: true, [$style.active]: modelValue === tab.key }"
		class="_button"
		click-anime
		@click="emit('update:modelValue', tab.key)"
	>
		{{ tab.label ?? tab.key }}
	</button>
</div>
</template>

<script lang="ts">
export interface Tab {
	key: string;
	label?: string;
}
</script>

<script setup lang="ts">
defineProps<{
		modelValue: string;
		tabs: Tab[];
	}>();
const emit = defineEmits<{
		(ev: 'update:modelValue', v: string): void;
	}>();
</script>

<style module lang="scss">
.tabstrip {
	display: flex;
	font-size: 90%;

	padding: calc(var(--margin) / 2) 0;
	background: color-mix(in srgb, var(--bg) 65%, transparent);
	backdrop-filter: var(--blur, blur(15px));
	border-radius: var(--radius-sm);

	> * {
		flex: 1;
	}
}

.button {
	padding: 10px 8px;
	margin-left: 0.4rem;
	margin-right: 0.4rem;
	border-radius: var(--radius-sm);

	&:disabled {
		cursor: default;
	}

	&.active {
		color: var(--accent);
		background: var(--accentedBg);
	}

	&:not(.active):hover {
		color: var(--fgHighlighted);
		background: var(--panelHighlight);
	}

	&:not(:first-child) {
		margin-left: 8px;
	}
}

@container (max-width: 500px) {
	.tabstrip {
		font-size: 80%;
	}
}
</style>
