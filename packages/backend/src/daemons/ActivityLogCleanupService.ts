/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { LessThan } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import { bindThis } from '@/decorators.js';
import type { ActivityLogsRepository } from '@/models/_.js';

// 10 minutes
export const scanInterval = 1000 * 60 * 10;

@Injectable()
export class ActivityLogCleanupService implements OnApplicationShutdown {
	private scanTimer: NodeJS.Timeout | null = null;

	constructor(
		@Inject(DI.config)
		private readonly config: Config,

		@Inject(DI.activityLogsRepository)
		private readonly activityLogsRepository: ActivityLogsRepository,
	) {}

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
		await this.activityLogsRepository.delete({
			at: LessThan(oldestAllowed),
		});
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
