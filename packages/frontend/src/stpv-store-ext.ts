export const TimelineSwipeKeys = [
	'home',
	'local',
	'social',
	'bubble',
	'global',
	'following',
	'lists',
	'antennas',
	'channel',
] as const;

export const stpvDefaultStoreExtension = {
	stpvNoteEmojiScale: {
		where: 'device',
		default: 100 as number,
	},
	stpvReactionEmojiScale: {
		where: 'device',
		default: 100 as number,
	},
	stpvVisibilityColorsEnabled: {
		where: 'device',
		default: false as boolean,
	},
	stpvVisibilityColors: {
		where: 'device',
		default: { home: '#00ffff', followers: '#ff00ff', localOnly: '#64ff64', specified: '#0000ff', private: '#6464ff' } as Record<'home' | 'followers' | 'localOnly' | 'specified' | 'private', string>,
	},
	stpvVisibilityColorOpacity: {
		where: 'device',
		default: 20 as number,
	},
	chineseAutospacing: {
		where: 'device',
		default: null as 'all' | 'special' | null,
	},
	stpvDisableAllReactions: {
		where: 'device',
		default: false as boolean,
	},
	stpvClientMutedUsers: {
		where: 'account',
		default: [] as string[],
	},
	stpvClientMutedNotes: {
		where: 'account',
		default: [] as string[],
	},
	stpvClientMutedDomains: {
		where: 'account',
		default: [] as string[],
	},
	stpvHideReplyAcct: {
		where: 'device',
		default: true as boolean,
	},
	stpvAdvancedPostForm: {
		where: 'device',
		default: false as boolean,
	},
	stpvPFDefaultPrefix: {
		where: 'device',
		default: '' as string,
	},
	stpvPFDefaultSuffix: {
		where: 'device',
		default: '' as string,
	},
	stpvCombineRepliesQuotes: {
		where: 'device',
		default: false,
	},
	stpvDisabledTimelineSwipes: {
		where: 'device',
		default: [] as (typeof TimelineSwipeKeys[number])[],
	},
	stpvEmojiPickerItemSize: {
		where: 'device',
		default: 1.25 as number,
	},
	stpvAprilFools: {
		where: 'device',
		default: true as boolean,
	},
} as const;
