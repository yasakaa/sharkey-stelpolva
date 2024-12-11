/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import Redis, { RedisOptions } from 'ioredis';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import Logger from '@/logger.js';
import { Timeout, TimeoutService } from '@/core/TimeoutService.js';
import { LoggerService } from './LoggerService.js';

/**
 * Target number of connections to keep open and ready for use.
 * The pool may grow beyond this during bursty traffic, but it will always shrink back to this number.
 * The pool may remain below this number is the server never experiences enough traffic to consume this many clients.
 */
export const poolSize = 16;

/**
 * How often to drop an idle connection from the pool.
 * This will never shrink the pool below poolSize.
 */
export const poolShrinkInterval = 5 * 1000; // 5 seconds

@Injectable()
export class RedisConnectionPool implements OnApplicationShutdown {
	private readonly poolShrinkTimer: Timeout;
	private readonly pool: Redis.Redis[] = [];
	private readonly logger: Logger;
	private readonly redisOptions: RedisOptions;

	constructor(@Inject(DI.config) config: Config, loggerService: LoggerService, timeoutService: TimeoutService) {
		this.logger = loggerService.getLogger('redis-pool');
		this.poolShrinkTimer = timeoutService.setInterval(() => this.shrinkPool(), poolShrinkInterval);
		this.redisOptions = {
			...config.redis,

			// Set lazyConnect so that we can await() the connection manually.
			// This helps to avoid a "stampede" of new connections (which are processed in the background!) under bursty conditions.
			lazyConnect: true,
			enableOfflineQueue: false,
		};
	}

	/**
	 * Gets a Redis connection from the pool, or creates a new connection if the pool is empty.
	 * The returned object MUST be returned with a call to free(), even in the case of exceptions!
	 * Use a try...finally block for safe handling.
	 */
	public async alloc(): Promise<Redis.Redis> {
		let redis = this.pool.pop();

		// The pool may be empty if we're under heavy load and/or we haven't opened all connections.
		// Just construct a new instance, which will eventually be added to the pool.
		// Excess clients will be disposed eventually.
		if (!redis) {
			redis = new Redis.Redis(this.redisOptions);
			await redis.connect();
		}

		return redis;
	}

	/**
	 * Returns a Redis connection to the pool.
	 * The instance MUST not be used after returning!
	 * Use a try...finally block for safe handling.
	 */
	public async free(redis: Redis.Redis): Promise<void> {
		// https://redis.io/docs/latest/commands/reset/
		await redis.reset();

		this.pool.push(redis);
	}

	public async onApplicationShutdown(): Promise<void> {
		// Cancel timer, otherwise it will cause a memory leak
		clearInterval(this.poolShrinkTimer);

		// Disconnect all remaining instances
		while (this.pool.length > 0) {
			await this.dropClient();
		}
	}

	private async shrinkPool(): Promise<void> {
		this.logger.debug(`Pool size is ${this.pool.length}`);
		if (this.pool.length > poolSize) {
			await this.dropClient();
		}
	}

	private async dropClient(): Promise<void> {
		try {
			const redis = this.pool.pop();
			await redis?.quit();
		} catch (err) {
			this.logger.warn(`Error disconnecting from redis: ${err}`, { err });
		}
	}
}
