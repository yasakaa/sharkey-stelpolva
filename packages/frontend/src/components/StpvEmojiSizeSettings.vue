<!--
SPDX-FileCopyrightText: sharkey-stelpolva contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<FormSection>
	<template #label>{{ i18n.ts._stpvEmojiSize.title }}</template>
	<div class="_gaps_m">
		<div>{{ i18n.ts._stpvEmojiSize.description }}</div>
		<div v-if="previewNote" :class="$style.preview" role="img" :aria-label="i18n.ts._stpvEmojiSize.preview">
			<div inert>
				<SkNote :note="previewNote" :mock="true"/>
			</div>
		</div>
		<MkInfo v-if="store.r.stpvDisableAllReactions.value">{{ i18n.ts._stpvEmojiSize.reactionsHidden }}</MkInfo>
		<label class="_gaps_s">
			<span>{{ i18n.ts._stpvEmojiSize.note }}: {{ noteScale }}%</span>
			<input v-model.number="noteScale" :class="$style.slider" type="range" min="50" max="150" step="5" :aria-valuetext="`${noteScale}%`">
		</label>
		<label class="_gaps_s">
			<span>{{ i18n.ts._stpvEmojiSize.reaction }}: {{ reactionScale }}%</span>
			<input v-model.number="reactionScale" :class="$style.slider" type="range" min="50" max="150" step="5" :aria-valuetext="`${reactionScale}%`">
		</label>
		<MkButton @click="reset">{{ i18n.ts._stpvEmojiSize.reset }}</MkButton>
		<div class="_caption">{{ i18n.ts._stpvEmojiSize.customCss }}</div>
	</div>
</FormSection>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import type * as Misskey from 'misskey-js';
import { url } from '@@/js/config.js';
import FormSection from '@/components/form/section.vue';
import MkButton from '@/components/MkButton.vue';
import MkInfo from '@/components/MkInfo.vue';
import SkNote from '@/components/SkNote.vue';
import { customEmojis } from '@/custom-emojis.js';
import { $i } from '@/i.js';
import { i18n } from '@/i18n.js';
import { store } from '@/store.js';

const noteScale = computed(store.makeGetterSetter('stpvNoteEmojiScale'));
const reactionScale = computed(store.makeGetterSetter('stpvReactionEmojiScale'));
const createdAt = new Date().toISOString();
const previewNote = computed<Misskey.entities.Note | null>(() => {
	if (!$i) return null;
	const samples = customEmojis.value.filter(emoji => !emoji.isSensitive).slice(0, 2);
	const urls = samples.length > 0 ? samples.map(emoji => emoji.url) : [`${url}/client-assets/speaker_high_volume_3d.png`];
	const names = urls.map((_, index) => `stpv_size_preview_${index}`);
	return {
		id: 'stpv-emoji-size-preview',
		threadId: 'stpv-emoji-size-preview',
		createdAt,
		userId: 'stpv-emoji-size-preview-user',
		userHost: 'preview.invalid',
		// A mock remote author lets MFM use the supplied URLs, including the
		// bundled fallback when this instance has no custom emoji yet.
		user: { ...$i, id: 'stpv-emoji-size-preview-user', host: 'preview.invalid', instance: undefined },
		text: `${i18n.ts._stpvEmojiSize.sampleText}\n${names.map(name => `:${name}:`).join(' ')}\n${i18n.ts._stpvEmojiSize.sampleText}`,
		visibility: 'public',
		localOnly: false,
		isMutingThread: false,
		isMutingNote: false,
		isFavorited: false,
		isRenoted: false,
		bypassSilence: false,
		emojis: Object.fromEntries(names.map((name, index) => [name, urls[index]])),
		reactionAcceptance: null,
		reactionEmojis: Object.fromEntries(names.map((name, index) => [`${name}@preview.invalid`, urls[index]])),
		reactions: Object.fromEntries(names.map((name, index) => [`:${name}@preview.invalid:`, index + 2])),
		reactionCount: names.reduce((total, _, index) => total + index + 2, 0),
		renoteCount: 0,
		repliesCount: 0,
		files: [],
	};
});

function reset() {
	noteScale.value = 100;
	reactionScale.value = 100;
}
</script>

<style lang="scss" module>
.preview {
	min-width: 0;
	overflow: hidden;
	border: 1px solid var(--MI_THEME-divider);
	border-radius: var(--MI-radius-sm);
	background: var(--MI_THEME-panel);
}

.slider {
	display: block;
	width: 100%;
	min-height: 2.75rem;
	margin: 0;
	accent-color: var(--MI_THEME-accent);
}
</style>
