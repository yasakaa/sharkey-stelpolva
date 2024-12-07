/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import Limiter from 'ratelimiter';
import * as Redis from 'ioredis';
import { DI } from '@/di-symbols.js';
import type Logger from '@/logger.js';
import { LoggerService } from '@/core/LoggerService.js';
import { bindThis } from '@/decorators.js';
import type { LimitInfo } from '@/server/api/SkRateLimiterService.js';
import { EnvService } from '@/core/EnvService.js';
import type { IEndpointMeta } from './endpoints.js';

/** @deprecated Use SkRateLimiterService instead */
@Injectable()
export class RateLimiterService {
	protected readonly logger: Logger;
	protected readonly disabled: boolean;

	constructor(
		@Inject(DI.redis)
		protected readonly redisClient: Redis.Redis,

		private loggerService: LoggerService,
		envService: EnvService,
	) {
		this.logger = this.loggerService.getLogger('limiter');
		this.disabled = envService.env.NODE_ENV !== 'production';
	}

	@bindThis
	public limit(limitation: IEndpointMeta['limit'] & { key: NonNullable<string> }, actor: string, factor = 1): Promise<LimitInfo | void> {
		return new Promise<void>((ok, reject) => {
			if (this.disabled) ok();

			// Short-term limit
			const minP = (): void => {
				const minIntervalLimiter = new Limiter({
					id: `${actor}:${limitation.key}:min`,
					duration: limitation.minInterval! * factor,
					max: 1,
					db: this.redisClient,
				});

				minIntervalLimiter.get((err, info) => {
					if (err) {
						return reject({ code: 'ERR', info });
					}

					this.logger.debug(`${actor} ${limitation.key} min remaining: ${info.remaining}`);

					if (info.remaining === 0) {
						return reject({ code: 'BRIEF_REQUEST_INTERVAL', info });
					} else {
						if (hasLongTermLimit) {
							return maxP();
						} else {
							return ok();
						}
					}
				});
			};

			// Long term limit
			const maxP = (): void => {
				const limiter = new Limiter({
					id: `${actor}:${limitation.key}`,
					duration: limitation.duration! * factor,
					max: limitation.max! / factor,
					db: this.redisClient,
				});

				limiter.get((err, info) => {
					if (err) {
						return reject({ code: 'ERR', info });
					}

					this.logger.debug(`${actor} ${limitation.key} max remaining: ${info.remaining}`);

					if (info.remaining === 0) {
						return reject({ code: 'RATE_LIMIT_EXCEEDED', info });
					} else {
						return ok();
					}
				});
			};

			const hasShortTermLimit = typeof limitation.minInterval === 'number';

			const hasLongTermLimit =
				typeof limitation.duration === 'number' &&
				typeof limitation.max === 'number';

			if (hasShortTermLimit) {
				minP();
			} else if (hasLongTermLimit) {
				maxP();
			} else {
				ok();
			}
		});
	}
}
