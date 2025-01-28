/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { UsersRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { CacheService } from '@/core/CacheService.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';

export const meta = {
	tags: ['admin'],

	requireCredential: true,
	requireModerator: true,
	kind: 'write:admin:cw-user',
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		userId: { type: 'string', format: 'misskey:id' },
		cw: { type: 'string', nullable: true },
	},
	required: ['userId', 'cw'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.usersRepository)
		private readonly usersRepository: UsersRepository,

		private readonly globalEventService: GlobalEventService,
	) {
		super(meta, paramDef, async ps => {
			const result = await this.usersRepository.update(ps.userId, {
				// Collapse empty strings to null
				// eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
				mandatoryCW: ps.cw || null,
			});

			if (result.affected && result.affected < 1) {
				throw new Error('No such user');
			}

			// Synchronize caches and other processes
			this.globalEventService.publishInternalEvent('localUserUpdated', { id: ps.userId });
		});
	}
}
