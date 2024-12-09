/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { LessThan } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import { bindThis } from '@/decorators.js';
import type { ApInboxLogsRepository } from '@/models/_.js';
import { LoggerService } from '@/core/LoggerService.js';
import Logger from '@/logger.js';

// 10 minutes
export const scanInterval = 1000 * 60 * 10;

@Injectable()
export class ApLogCleanupService implements OnApplicationShutdown {
	private readonly logger: Logger;
	private scanTimer: NodeJS.Timeout | null = null;

	constructor(
		@Inject(DI.config)
		private readonly config: Config,

		@Inject(DI.apInboxLogsRepository)
		private readonly apInboxLogsRepository: ApInboxLogsRepository,

		loggerService: LoggerService,
	) {
		this.logger = loggerService.getLogger('activity-log-cleanup');
	}

	@bindThis
	public async start(): Promise<void> {
		// Just in case start() gets called multiple times.
		this.dispose();

		// Prune at startup, in case the server was rebooted during the interval.
		// noinspection ES6MissingAwait
		this.tick();

		// Prune on a regular interval for the lifetime of the server.
		this.scanTimer = setInterval(this.tick, scanInterval);
	}

	@bindThis
	private async tick(): Promise<void> {
		// This is the date in UTC of the oldest log to KEEP
		const oldestAllowed = new Date(Date.now() - this.config.activityLogging.maxAge);

		// Delete all logs older than the threshold.
		const { affected } = await this.apInboxLogsRepository.delete({
			at: LessThan(oldestAllowed),
		});

		this.logger.info(`Activity Log cleanup complete; removed ${affected ?? 0} expired logs.`);
	}

	@bindThis
	public onApplicationShutdown(): void {
		this.dispose();
	}

	@bindThis
	public dispose(): void {
		if (this.scanTimer) {
			clearInterval(this.scanTimer);
			this.scanTimer = null;
		}
	}
}
