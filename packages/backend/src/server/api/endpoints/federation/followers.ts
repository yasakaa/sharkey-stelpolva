/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { MiBlocking, MiUserProfile, MiFollowing, type FollowingsRepository } from '@/models/_.js';
import { QueryService } from '@/core/QueryService.js';
import { FollowingEntityService } from '@/core/entities/FollowingEntityService.js';
import { DI } from '@/di-symbols.js';
import { RoleService } from '@/core/RoleService.js';

export const meta = {
	tags: ['federation'],

	requireCredential: true,
	kind: 'read:account',

	res: {
		type: 'array',
		optional: false, nullable: false,
		items: {
			type: 'object',
			optional: false, nullable: false,
			ref: 'Following',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		host: { type: 'string' },
		sinceId: { type: 'string', format: 'misskey:id' },
		untilId: { type: 'string', format: 'misskey:id' },
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
		includeFollower: { type: 'boolean', default: false },
		includeFollowee: { type: 'boolean', default: true },
	},
	required: ['host'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.followingsRepository)
		private followingsRepository: FollowingsRepository,

		private followingEntityService: FollowingEntityService,
		private queryService: QueryService,
		private roleService: RoleService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const query = this.queryService.makePaginationQuery(this.followingsRepository.createQueryBuilder('following'), ps.sinceId, ps.untilId)
				.andWhere('following.followeeHost = :host', { host: ps.host });

			if (!await this.roleService.isModerator(me)) {
				query.setParameter('me', me.id);

				// Make sure that the followee doesn't block us, as their profile is included in the response.
				query.leftJoin(MiBlocking, 'blocking', 'blocking."blockerId" = following."followeeId" AND blocking."blockeeId" = :me');
				query.andWhere('blocking.id IS NULL');

				// Make sure that the followee hasn't hidden this connection.
				query.leftJoin(MiUserProfile, 'followee', 'followee."userId" = following."followeeId"');
				query.leftJoin(MiFollowing, 'me_following_followee', 'me_following_followee."followerId" = :me AND me_following_followee."followeeId" = following."followerId"');
				query.andWhere('(followee."userId" = :me OR followee."followersVisibility" = \'public\' OR (followee."followersVisibility" = \'followers\' AND me_following_followee.id IS NOT NULL))');

				// Make sure that the follower hasn't hidden this connection.
				query.leftJoin(MiUserProfile, 'follower', 'follower."userId" = following."followerId"');
				query.leftJoin(MiFollowing, 'me_following_follower', 'me_following_follower."followerId" = :me AND me_following_follower."followeeId" = following."followerId"');
				query.andWhere('(follower."userId" = :me OR follower."followingVisibility" = \'public\' OR (follower."followingVisibility" = \'followers\' AND me_following_follower.id IS NOT NULL))');
			}

			const followings = await query
				.limit(ps.limit)
				.getMany();

			return await this.followingEntityService.packMany(followings, me, { populateFollowee: ps.includeFollowee, populateFollower: ps.includeFollower });
		});
	}
}
