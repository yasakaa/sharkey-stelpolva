import { computed } from 'vue';
import { store } from '@/store.js';

export const noteEmojiStyle = computed(() => ({
	'--stpv-note-emoji-height': `${3 * store.r.stpvNoteEmojiScale.value / 100}em`,
}));
