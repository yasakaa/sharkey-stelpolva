/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import type { Packed } from '@/misc/json-schema.js';
import { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import { bindThis } from '@/decorators.js';
import type { JsonObject } from '@/misc/json-value.js';
import Channel, { type MiChannelService } from '../channel.js';

class ChannelChannel extends Channel {
	public readonly chName = 'channel';
	public static shouldShare = false;
	public static requireCredential = false as const;
	private channelId: string;
	private withFiles: boolean;
	private withRenotes: boolean;

	constructor(
		noteEntityService: NoteEntityService,

		id: string,
		connection: Channel['connection'],
	) {
		super(id, connection, noteEntityService);
		//this.onNote = this.onNote.bind(this);
	}

	@bindThis
	public async init(params: JsonObject) {
		if (typeof params.channelId !== 'string') return;
		this.channelId = params.channelId;
		this.withFiles = !!(params.withFiles ?? false);
		this.withRenotes = !!(params.withRenotes ?? true);

		// Subscribe stream
		this.subscriber.on('notesStream', this.onNote);
	}

	@bindThis
	private async onNote(note: Packed<'Note'>) {
		if (note.channelId !== this.channelId) return;

		if (this.withFiles && (note.fileIds == null || note.fileIds.length === 0)) return;

		if (note.renote && note.text == null && (note.fileIds == null || note.fileIds.length === 0) && !this.withRenotes) return;

		if (this.isNoteMutedOrBlocked(note)) return;

		const clonedNote = await this.assignMyReaction(note);
		await this.hideNote(clonedNote);

		this.connection.cacheNote(clonedNote);

		this.send('note', clonedNote);
	}

	@bindThis
	public dispose() {
		// Unsubscribe events
		this.subscriber.off('notesStream', this.onNote);
	}
}

@Injectable()
export class ChannelChannelService implements MiChannelService<false> {
	public readonly shouldShare = ChannelChannel.shouldShare;
	public readonly requireCredential = ChannelChannel.requireCredential;
	public readonly kind = ChannelChannel.kind;

	constructor(
		private noteEntityService: NoteEntityService,
	) {
	}

	@bindThis
	public create(id: string, connection: Channel['connection']): ChannelChannel {
		return new ChannelChannel(
			this.noteEntityService,
			id,
			connection,
		);
	}
}
