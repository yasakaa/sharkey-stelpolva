<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkStickyContainer>
	<template #header>
		<SkTab v-model="tab" :tabs="tabs"/>
	</template>
	<MkLazy>
		<div v-if="tab === 'pinned'" class="_gaps">
			<div v-if="user.pinnedNotes.length < 1" class="_fullinfo">
				<img :src="infoImageUrl" class="_ghost" aria-hidden="true" :alt="i18n.ts.noNotes"/>
				<div>{{ i18n.ts.noNotes }}</div>
			</div>
			<div v-else class="_panel">
				<MkNote v-for="note of user.pinnedNotes" :key="note.id" class="note" :class="$style.pinnedNote" :note="note" :pinned="true"/>
			</div>
		</div>
		<MkNotes v-else :class="$style.tl" :noGap="true" :pagination="pagination"/>
	</MkLazy>
</MkStickyContainer>
</template>

<script setup lang="ts">
import { ref, computed, defineAsyncComponent } from 'vue';
import * as Misskey from 'misskey-js';
import MkNotes from '@/components/MkNotes.vue';
import SkTab from '@/components/SkTab.vue';
import { i18n } from '@/i18n.js';
import { infoImageUrl } from '@/instance.js';
import { Paging } from '@/components/MkPagination.vue';
import { Tab } from '@/components/SkTab.vue';
import { defaultStore } from '@/store.js';

const MkNote = defineAsyncComponent(() => defaultStore.state.noteDesign === 'sharkey' ? import('@/components/SkNote.vue') : import('@/components/MkNote.vue'));

const props = withDefaults(defineProps<{
	user: Misskey.entities.UserDetailed;
	includeFeatured: boolean;
	includePinned: boolean;
}>(), {
	includeFeatured: true,
	includePinned: true,
});

const tab = ref<string | null>('notes');

const tabs = computed(() => {
	const t: Tab[] = [
		{ key: 'notes', label: i18n.ts.notes },
		{ key: 'all', label: i18n.ts.all },
		{ key: 'files', label: i18n.ts.withFiles },
	];

	if (props.includeFeatured) {
		t.unshift({
			key: 'featured',
			label: i18n.ts.featured,
		});
	}

	if (props.includePinned) {
		t.unshift({
			key: 'pinned',
			label: i18n.ts.pinnedOnly,
		});
	}

	return t;
});

const pagination = computed(() => {
	if (tab.value === 'featured') {
		return {
			endpoint: 'users/featured-notes' as const,
			limit: 10,
			params: {
				userId: props.user.id,
			},
		} satisfies Paging<'users/featured-notes'>;
	} else {
		return {
			endpoint: 'users/notes' as const,
			limit: 10,
			params: {
				userId: props.user.id,
				withRenotes: tab.value === 'all',
				withReplies: tab.value === 'all',
				withChannelNotes: tab.value === 'all',
				withFiles: tab.value === 'files',
			},
		} satisfies Paging<'users/notes'>;
	}
});
</script>

<style module lang="scss">
.tl {
	background: var(--bg);
	border-radius: var(--radius);
	overflow: clip;
}

.pinnedNote:not(:last-child) {
	border-bottom: solid 0.5px var(--divider);
}
</style>
