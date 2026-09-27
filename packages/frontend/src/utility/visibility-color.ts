import { store } from '@/store.js';

type VisibilityTarget = {
	visibility: string;
	localOnly?: boolean;
	visibleUserIds?: string[];
};

export function visibilityColorStyle(note: VisibilityTarget, panel = 'panel') {
	if (!store.r.stpvVisibilityColorsEnabled.value) return {};
	// A restricted audience takes precedence over federation status.
	const key = note.visibility === 'specified'
		? (note.visibleUserIds?.length === 0 ? 'private' : 'specified')
		: note.visibility === 'followers' ? 'followers'
			: note.localOnly ? 'localOnly'
				: note.visibility === 'home' ? 'home' : null;
	if (key == null) return {};
	const color = store.r.stpvVisibilityColors.value[key];
	if (!/^#[0-9a-f]{6}$/i.test(color)) return {};
	const opacity = Math.min(100, Math.max(0, store.r.stpvVisibilityColorOpacity.value));
	return { backgroundColor: `color-mix(in srgb, var(--MI_THEME-${panel}), ${color} ${opacity}%)` };
}
