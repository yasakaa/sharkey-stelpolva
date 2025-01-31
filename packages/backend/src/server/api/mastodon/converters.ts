/*
 * SPDX-FileCopyrightText: marie and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Entity } from 'megalodon';
import mfm from '@transfem-org/sfm-js';
import { DI } from '@/di-symbols.js';
import { MfmService } from '@/core/MfmService.js';
import type { Config } from '@/config.js';
import { IMentionedRemoteUsers, MiNote } from '@/models/Note.js';
import type { MiUser } from '@/models/User.js';
import type { NoteEditRepository, UserProfilesRepository } from '@/models/_.js';
import { awaitAll } from '@/misc/prelude/await-all.js';
import { CustomEmojiService } from '@/core/CustomEmojiService.js';
import { DriveFileEntityService } from '@/core/entities/DriveFileEntityService.js';
import { IdService } from '@/core/IdService.js';
import type { Packed } from '@/misc/json-schema.js';
import { GetterService } from '../GetterService.js';

// Missing from Megalodon apparently
// https://docs.joinmastodon.org/entities/StatusEdit/
export interface StatusEdit {
	content: string;
	spoiler_text: string;
	sensitive: boolean;
	created_at: string;
	account: MastodonEntity.Account;
	poll?: {
		options: {
			title: string;
		}[]
	},
	media_attachments: MastodonEntity.Attachment[],
	emojis: MastodonEntity.Emoji[],
}

export const escapeMFM = (text: string): string => text
	.replace(/&/g, '&amp;')
	.replace(/</g, '&lt;')
	.replace(/>/g, '&gt;')
	.replace(/"/g, '&quot;')
	.replace(/'/g, '&#39;')
	.replace(/`/g, '&#x60;')
	.replace(/\r?\n/g, '<br>');

@Injectable()
export class MastoConverters {
	constructor(
		@Inject(DI.config)
		private readonly config: Config,

		@Inject(DI.userProfilesRepository)
		private readonly userProfilesRepository: UserProfilesRepository,

		@Inject(DI.noteEditRepository)
		private readonly noteEditRepository: NoteEditRepository,

		private readonly mfmService: MfmService,
		private readonly getterService: GetterService,
		private readonly customEmojiService: CustomEmojiService,
		private readonly idService: IdService,
		private readonly driveFileEntityService: DriveFileEntityService,
	) {}

	private encode(u: MiUser, m: IMentionedRemoteUsers): MastodonEntity.Mention {
		let acct = u.username;
		// eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
		let acctUrl = `https://${u.host || this.config.host}/@${u.username}`;
		let url: string | null = null;
		if (u.host) {
			const info = m.find(r => r.username === u.username && r.host === u.host);
			acct = `${u.username}@${u.host}`;
			acctUrl = `https://${u.host}/@${u.username}`;
			if (info) url = info.url ?? info.uri;
		}
		return {
			id: u.id,
			username: u.username,
			acct: acct,
			url: url ?? acctUrl,
		};
	}

	public fileType(s: string): 'unknown' | 'image' | 'gifv' | 'video' | 'audio' {
		if (s === 'image/gif') {
			return 'gifv';
		}
		if (s.includes('image')) {
			return 'image';
		}
		if (s.includes('video')) {
			return 'video';
		}
		if (s.includes('audio')) {
			return 'audio';
		}
		return 'unknown';
	}

	public encodeFile(f: Packed<'DriveFile'>): MastodonEntity.Attachment {
		return {
			id: f.id,
			type: this.fileType(f.type),
			url: f.url,
			remote_url: f.url,
			preview_url: f.thumbnailUrl,
			text_url: f.url,
			meta: {
				width: f.properties.width,
				height: f.properties.height,
			},
			description: f.comment ? f.comment : null,
			blurhash: f.blurhash ? f.blurhash : null,
		};
	}

	public async getUser(id: string): Promise<MiUser> {
		return this.getterService.getUser(id).then(p => {
			return p;
		});
	}

	private async encodeField(f: Entity.Field): Promise<MastodonEntity.Field> {
		return {
			name: f.name,
			value: await this.mfmService.toMastoApiHtml(mfm.parse(f.value), [], true) ?? escapeMFM(f.value),
			verified_at: null,
		};
	}

	public async convertAccount(account: Entity.Account | MiUser): Promise<MastodonEntity.Account> {
		const user = await this.getUser(account.id);
		const profile = await this.userProfilesRepository.findOneBy({ userId: user.id });
		const emojis = await this.customEmojiService.populateEmojis(user.emojis, user.host ? user.host : this.config.host);
		const emoji: Entity.Emoji[] = [];
		Object.entries(emojis).forEach(entry => {
			const [key, value] = entry;
			emoji.push({
				shortcode: key,
				static_url: value,
				url: value,
				visible_in_picker: true,
				category: undefined,
			});
		});
		const fqn = `${user.username}@${user.host ?? this.config.hostname}`;
		let acct = user.username;
		// eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
		let acctUrl = `https://${user.host || this.config.host}/@${user.username}`;
		const acctUri = `https://${this.config.host}/users/${user.id}`;
		if (user.host) {
			acct = `${user.username}@${user.host}`;
			acctUrl = `https://${user.host}/@${user.username}`;
		}
		return awaitAll({
			id: account.id,
			username: user.username,
			acct: acct,
			fqn: fqn,
			display_name: user.name ?? user.username,
			locked: user.isLocked,
			created_at: this.idService.parse(user.id).date.toISOString(),
			followers_count: profile?.followersVisibility === 'public' ? user.followersCount : 0,
			following_count: profile?.followingVisibility === 'public' ? user.followingCount : 0,
			statuses_count: user.notesCount,
			note: profile?.description ?? '',
			url: user.uri ?? acctUrl,
			uri: user.uri ?? acctUri,
			avatar: user.avatarUrl ? user.avatarUrl : 'https://dev.joinsharkey.org/static-assets/avatar.png',
			avatar_static: user.avatarUrl ? user.avatarUrl : 'https://dev.joinsharkey.org/static-assets/avatar.png',
			header: user.bannerUrl ? user.bannerUrl : 'https://dev.joinsharkey.org/static-assets/transparent.png',
			header_static: user.bannerUrl ? user.bannerUrl : 'https://dev.joinsharkey.org/static-assets/transparent.png',
			emojis: emoji,
			moved: null, //FIXME
			fields: Promise.all(profile?.fields.map(async p => this.encodeField(p)) ?? []),
			bot: user.isBot,
			discoverable: user.isExplorable,
			noindex: user.noindex,
			group: null,
			suspended: user.isSuspended,
			limited: user.isSilenced,
		});
	}

	public async getEdits(id: string) {
		const note = await this.getterService.getNote(id);

		const noteUser = await this.getUser(note.userId).then(async (p) => await this.convertAccount(p));
		const edits = await this.noteEditRepository.find({ where: { noteId: note.id }, order: { id: 'ASC' } });
		const history: Promise<StatusEdit>[] = [];

		// TODO this looks wrong, according to mastodon docs
		let lastDate = this.idService.parse(note.id).date;
		for (const edit of edits) {
			const files = this.driveFileEntityService.packManyByIds(edit.fileIds);
			const item = {
				account: noteUser,
				content: this.mfmService.toMastoApiHtml(mfm.parse(edit.newText ?? ''), JSON.parse(note.mentionedRemoteUsers)).then(p => p ?? ''),
				created_at: lastDate.toISOString(),
				emojis: [],
				sensitive: edit.cw != null && edit.cw.length > 0,
				spoiler_text: edit.cw ?? '',
				media_attachments: files.then(files => files.length > 0 ? files.map((f) => this.encodeFile(f)) : []),
			};
			lastDate = edit.updatedAt;
			history.push(awaitAll(item));
		}

		return await Promise.all(history);
	}

	private async convertReblog(status: Entity.Status | null): Promise<MastodonEntity.Status | null> {
		if (!status) return null;
		return await this.convertStatus(status);
	}

	public async convertStatus(status: Entity.Status): Promise<MastodonEntity.Status> {
		const convertedAccount = this.convertAccount(status.account);
		const note = await this.getterService.getNote(status.id);
		const noteUser = await this.getUser(status.account.id);

		const emojis = await this.customEmojiService.populateEmojis(note.emojis, noteUser.host ? noteUser.host : this.config.host);
		const emoji: Entity.Emoji[] = [];
		Object.entries(emojis).forEach(entry => {
			const [key, value] = entry;
			emoji.push({
				shortcode: key,
				static_url: value,
				url: value,
				visible_in_picker: true,
				category: undefined,
			});
		});

		const mentions = Promise.all(note.mentions.map(p =>
			this.getUser(p)
				.then(u => this.encode(u, JSON.parse(note.mentionedRemoteUsers)))
				.catch(() => null)))
			.then(p => p.filter(m => m)) as Promise<Entity.Mention[]>;

		const tags = note.tags.map(tag => {
			return {
				name: tag,
				url: `${this.config.url}/tags/${tag}`,
			} as Entity.Tag;
		});

		// This must mirror the usual isQuote / isPureRenote logic used elsewhere.
		// eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
		const isQuote = note.renoteId && (note.text || note.cw || note.fileIds.length > 0 || note.hasPoll || note.replyId);

		const renote: Promise<MiNote> | null = note.renoteId ? this.getterService.getNote(note.renoteId) : null;

		const quoteUri = Promise.resolve(renote).then(renote => {
			if (!renote || !isQuote) return null;
			return renote.url ?? renote.uri ?? `${this.config.url}/notes/${renote.id}`;
		});

		const text = note.text;
		const content = text !== null
			? quoteUri
				.then(quoteUri => this.mfmService.toMastoApiHtml(mfm.parse(text), JSON.parse(note.mentionedRemoteUsers), false, quoteUri))
				.then(p => p ?? escapeMFM(text))
			: '';

		// noinspection ES6MissingAwait
		return await awaitAll({
			id: note.id,
			uri: note.uri ?? `https://${this.config.host}/notes/${note.id}`,
			url: note.url ?? note.uri ?? `https://${this.config.host}/notes/${note.id}`,
			account: convertedAccount,
			in_reply_to_id: note.replyId,
			in_reply_to_account_id: note.replyUserId,
			reblog: !isQuote ? await this.convertReblog(status.reblog) : null,
			content: content,
			content_type: 'text/x.misskeymarkdown',
			text: note.text,
			created_at: status.created_at,
			emojis: emoji,
			replies_count: note.repliesCount,
			reblogs_count: note.renoteCount,
			favourites_count: status.favourites_count,
			reblogged: false,
			favourited: status.favourited,
			muted: status.muted,
			sensitive: status.sensitive,
			spoiler_text: note.cw ?? '',
			visibility: status.visibility,
			media_attachments: status.media_attachments,
			mentions: mentions,
			tags: tags,
			card: null, //FIXME
			poll: status.poll ?? null,
			application: null, //FIXME
			language: null, //FIXME
			pinned: false, //FIXME
			reactions: status.emoji_reactions,
			emoji_reactions: status.emoji_reactions,
			bookmarked: false, //FIXME
			quote: isQuote ? await this.convertReblog(status.reblog) : null,
			edited_at: note.updatedAt?.toISOString() ?? null,
		});
	}
}

function simpleConvert<T>(data: T): T {
	// copy the object to bypass weird pass by reference bugs
	return Object.assign({}, data);
}

export function convertAccount(account: Entity.Account) {
	return simpleConvert(account);
}
export function convertAnnouncement(announcement: Entity.Announcement) {
	return simpleConvert(announcement);
}
export function convertAttachment(attachment: Entity.Attachment) {
	return simpleConvert(attachment);
}
export function convertFilter(filter: Entity.Filter) {
	return simpleConvert(filter);
}
export function convertList(list: Entity.List) {
	return simpleConvert(list);
}
export function convertFeaturedTag(tag: Entity.FeaturedTag) {
	return simpleConvert(tag);
}

export function convertNotification(notification: Entity.Notification) {
	notification.account = convertAccount(notification.account);
	if (notification.status) notification.status = convertStatus(notification.status);
	return notification;
}

export function convertPoll(poll: Entity.Poll) {
	return simpleConvert(poll);
}

export function convertReaction(reaction: Entity.Reaction) {
	if (reaction.accounts) {
		reaction.accounts = reaction.accounts.map(convertAccount);
	}
	return reaction;
}

export function convertRelationship(relationship: Entity.Relationship) {
	return simpleConvert(relationship);
}

export function convertStatus(status: Entity.Status) {
	status.account = convertAccount(status.account);
	status.media_attachments = status.media_attachments.map((attachment) =>
		convertAttachment(attachment),
	);
	if (status.poll) status.poll = convertPoll(status.poll);
	if (status.reblog) status.reblog = convertStatus(status.reblog);

	return status;
}

export function convertStatusSource(status: Entity.StatusSource) {
	return simpleConvert(status);
}

export function convertConversation(conversation: Entity.Conversation) {
	conversation.accounts = conversation.accounts.map(convertAccount);
	if (conversation.last_status) {
		conversation.last_status = convertStatus(conversation.last_status);
	}

	return conversation;
}
