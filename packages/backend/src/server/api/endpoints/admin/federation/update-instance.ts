/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { InstancesRepository } from '@/models/_.js';
import { UtilityService } from '@/core/UtilityService.js';
import { DI } from '@/di-symbols.js';
import { FederatedInstanceService } from '@/core/FederatedInstanceService.js';
import { ModerationLogService } from '@/core/ModerationLogService.js';

export const meta = {
	tags: ['admin'],

	requireCredential: true,
	requireModerator: true,
	kind: 'write:admin:federation',
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		host: { type: 'string' },
		isSuspended: { type: 'boolean' },
		isNSFW: { type: 'boolean' },
		rejectReports: { type: 'boolean' },
		moderationNote: { type: 'string' },
		rejectQuotes: { type: 'boolean' },
	},
	required: ['host'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.instancesRepository)
		private instancesRepository: InstancesRepository,

		private utilityService: UtilityService,
		private federatedInstanceService: FederatedInstanceService,
		private moderationLogService: ModerationLogService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const instance = await this.instancesRepository.findOneBy({ host: this.utilityService.toPuny(ps.host) });

			if (instance == null) {
				throw new Error('instance not found');
			}

			const isSuspendedBefore = instance.suspensionState !== 'none';
			let suspensionState: undefined | 'manuallySuspended' | 'none';

			if (ps.isSuspended != null && isSuspendedBefore !== ps.isSuspended) {
				suspensionState = ps.isSuspended ? 'manuallySuspended' : 'none';
			}

			await this.federatedInstanceService.update(instance.id, {
				suspensionState,
				isNSFW: ps.isNSFW,
				rejectReports: ps.rejectReports,
				rejectQuotes: ps.rejectQuotes,
				moderationNote: ps.moderationNote,
			});

			if (ps.isSuspended != null && isSuspendedBefore !== ps.isSuspended) {
				if (ps.isSuspended) {
					this.moderationLogService.log(me, 'suspendRemoteInstance', {
						id: instance.id,
						host: instance.host,
					});
				} else {
					this.moderationLogService.log(me, 'unsuspendRemoteInstance', {
						id: instance.id,
						host: instance.host,
					});
				}
			}

			if (ps.isNSFW != null && instance.isNSFW !== ps.isNSFW) {
				const message = ps.rejectReports ? 'setRemoteInstanceNSFW' : 'unsetRemoteInstanceNSFW';
				this.moderationLogService.log(me, message, {
					id: instance.id,
					host: instance.host,
				});
			}

			if (ps.rejectReports != null && instance.rejectReports !== ps.rejectReports) {
				const message = ps.rejectReports ? 'rejectRemoteInstanceReports' : 'acceptRemoteInstanceReports';
				this.moderationLogService.log(me, message, {
					id: instance.id,
					host: instance.host,
				});
			}

			if (ps.rejectQuotes != null && instance.rejectQuotes !== ps.rejectQuotes) {
				const message = ps.rejectReports ? 'rejectQuotesInstance' : 'acceptQuotesInstance';
				this.moderationLogService.log(me, message, {
					id: instance.id,
					host: instance.host,
				});
			}

			if (ps.moderationNote != null && instance.moderationNote !== ps.moderationNote) {
				this.moderationLogService.log(me, 'updateRemoteInstanceNote', {
					id: instance.id,
					host: instance.host,
					before: instance.moderationNote,
					after: ps.moderationNote,
				});
			}
		});
	}
}
