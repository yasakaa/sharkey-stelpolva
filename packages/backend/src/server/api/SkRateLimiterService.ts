/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { TimeService } from '@/core/TimeService.js';
import { EnvService } from '@/core/EnvService.js';
import { DI } from '@/di-symbols.js';
import { BucketRateLimit, LegacyRateLimit, LimitInfo, RateLimit, hasMinLimit, isLegacyRateLimit, Keyed } from '@/misc/rate-limit-utils.js';

@Injectable()
export class SkRateLimiterService {
	private readonly disabled: boolean;

	constructor(
		@Inject(TimeService)
		private readonly timeService: TimeService,

		@Inject(DI.redis)
		private readonly redisClient: Redis.Redis,

		@Inject(EnvService)
		envService: EnvService,
	) {
		this.disabled = envService.env.NODE_ENV === 'test';
	}

	public async limit(limit: Keyed<RateLimit>, actor: string, factor = 1): Promise<LimitInfo> {
		if (this.disabled || factor === 0) {
			return {
				blocked: false,
				remaining: Number.MAX_SAFE_INTEGER,
				resetSec: 0,
				resetMs: 0,
				fullResetSec: 0,
				fullResetMs: 0,
			};
		}

		if (factor < 0) {
			throw new Error(`Rate limit factor is zero or negative: ${factor}`);
		}

		return await this.tryLimit(limit, actor, factor);
	}

	private async tryLimit(limit: Keyed<RateLimit>, actor: string, factor: number, retry = 1): Promise<LimitInfo> {
		try {
			if (isLegacyRateLimit(limit)) {
				return await this.limitLegacy(limit, actor, factor);
			} else {
				return await this.limitBucket(limit, actor, factor);
			}
		} catch (err) {
			// We may experience collision errors from optimistic locking.
			// This is expected, so we should retry a few times before giving up.
			// https://redis.io/docs/latest/develop/interact/transactions/#optimistic-locking-using-check-and-set
			if (err instanceof TransactionError && retry < 3) {
				return await this.tryLimit(limit, actor, factor, retry + 1);
			}

			throw err;
		}
	}

	private async limitLegacy(limit: Keyed<LegacyRateLimit>, actor: string, factor: number): Promise<LimitInfo> {
		const promises: Promise<LimitInfo | null>[] = [];

		// The "min" limit - if present - is handled directly.
		if (hasMinLimit(limit)) {
			promises.push(
				this.limitMin(limit, actor, factor),
			);
		}

		// Convert the "max" limit into a leaky bucket with 1 drip / second rate.
		if (limit.max != null && limit.duration != null) {
			promises.push(
				this.limitBucket({
					type: 'bucket',
					key: limit.key,
					size: limit.max,
					dripRate: Math.max(Math.round(limit.duration / limit.max), 1),
				}, actor, factor),
			);
		}

		const [lim1, lim2] = await Promise.all(promises);
		return {
			blocked: (lim1?.blocked || lim2?.blocked) ?? false,
			remaining: Math.min(lim1?.remaining ?? Number.MAX_SAFE_INTEGER, lim2?.remaining ?? Number.MAX_SAFE_INTEGER),
			resetSec: Math.max(lim1?.resetSec ?? 0, lim2?.resetSec ?? 0),
			resetMs: Math.max(lim1?.resetMs ?? 0, lim2?.resetMs ?? 0),
			fullResetSec: Math.max(lim1?.fullResetSec ?? 0, lim2?.fullResetSec ?? 0),
			fullResetMs: Math.max(lim1?.fullResetMs ?? 0, lim2?.fullResetMs ?? 0),
		};
	}

	private async limitMin(limit: Keyed<LegacyRateLimit> & { minInterval: number }, actor: string, factor: number): Promise<LimitInfo | null> {
		if (limit.minInterval === 0) return null;
		if (limit.minInterval < 0) throw new Error(`Invalid rate limit ${limit.key}: minInterval is negative (${limit.minInterval})`);

		const minInterval = Math.max(Math.ceil(limit.minInterval * factor), 0);
		const expirationSec = Math.max(Math.ceil(minInterval / 1000), 1);

		// Check for window clear
		const counter = await this.getLimitCounter(limit, actor, 'min');
		if (counter.counter > 0) {
			const isCleared = this.timeService.now - counter.timestamp >= minInterval;
			if (isCleared) {
				counter.counter = 0;
			}
		}

		// Increment the limit, then synchronize with redis
		const blocked = counter.counter > 0;
		if (!blocked) {
			counter.counter++;
			counter.timestamp = this.timeService.now;
			await this.updateLimitCounter(limit, actor, 'min', expirationSec, counter);
		}

		// Calculate limit status
		const resetMs = Math.max(minInterval - (this.timeService.now - counter.timestamp), 0);
		const resetSec = Math.ceil(resetMs / 1000);
		return { blocked, remaining: 0, resetSec, resetMs, fullResetSec: resetSec, fullResetMs: resetMs };
	}

	private async limitBucket(limit: Keyed<BucketRateLimit>, actor: string, factor: number): Promise<LimitInfo> {
		if (limit.size < 1) throw new Error(`Invalid rate limit ${limit.key}: size is less than 1 (${limit.size})`);
		if (limit.dripRate != null && limit.dripRate < 1) throw new Error(`Invalid rate limit ${limit.key}: dripRate is less than 1 (${limit.dripRate})`);
		if (limit.dripSize != null && limit.dripSize < 1) throw new Error(`Invalid rate limit ${limit.key}: dripSize is less than 1 (${limit.dripSize})`);

		const bucketSize = Math.max(Math.ceil(limit.size / factor), 1);
		const dripRate = Math.ceil(limit.dripRate ?? 1000);
		const dripSize = Math.ceil(limit.dripSize ?? 1);
		const expirationSec = Math.max(Math.ceil(bucketSize / dripRate), 1);

		// Simulate bucket drips
		const counter = await this.getLimitCounter(limit, actor, 'bucket');
		if (counter.counter > 0) {
			const dripsSinceLastTick = Math.floor((this.timeService.now - counter.timestamp) / dripRate) * dripSize;
			counter.counter = Math.max(counter.counter - dripsSinceLastTick, 0);
		}

		// Increment the limit, then synchronize with redis
		const blocked = counter.counter >= bucketSize;
		if (!blocked) {
			counter.counter++;
			counter.timestamp = this.timeService.now;
			await this.updateLimitCounter(limit, actor, 'bucket', expirationSec, counter);
		}

		// Calculate how much time is needed to free up a bucket slot
		const overflow = Math.max((counter.counter + 1) - bucketSize, 0);
		const dripsNeeded = Math.ceil(overflow / dripSize);
		const timeNeeded = Math.max((dripRate * dripsNeeded) - (this.timeService.now - counter.timestamp), 0);

		// Calculate limit status
		const remaining = Math.max(bucketSize - counter.counter, 0);
		const resetMs = timeNeeded;
		const resetSec = Math.ceil(resetMs / 1000);
		const fullResetMs = Math.ceil(counter.counter / dripSize) * dripRate;
		const fullResetSec = Math.ceil(fullResetMs / 1000);
		return { blocked, remaining, resetSec, resetMs, fullResetSec, fullResetMs };
	}

	private async getLimitCounter(limit: Keyed<RateLimit>, actor: string, subject: string): Promise<LimitCounter> {
		const timestampKey = createLimitKey(limit, actor, subject, 't');
		const counterKey = createLimitKey(limit, actor, subject, 'c');

		const [timestamp, counter] = await this.executeRedis(
			[
				['get', timestampKey],
				['get', counterKey],
			],
			[
				timestampKey,
				counterKey,
			],
		);

		return {
			timestamp: timestamp ? parseInt(timestamp) : 0,
			counter: counter ? parseInt(counter) : 0,
		};
	}

	private async updateLimitCounter(limit: Keyed<RateLimit>, actor: string, subject: string, expirationSec: number, counter: LimitCounter): Promise<void> {
		const timestampKey = createLimitKey(limit, actor, subject, 't');
		const counterKey = createLimitKey(limit, actor, subject, 'c');

		await this.executeRedis(
			[
				['set', timestampKey, counter.timestamp.toString(), 'EX', expirationSec],
				['set', counterKey, counter.counter.toString(), 'EX', expirationSec],
			],
			[
				timestampKey,
				counterKey,
			],
		);
	}

	private async executeRedis<Num extends number>(batch: RedisBatch<Num>, watch: string[]): Promise<RedisResults<Num>> {
		const results = await this.redisClient
			.multi(batch)
			.watch(watch)
			.exec();

		// Transaction error
		if (!results) {
			throw new TransactionError('Redis error: transaction conflict');
		}

		// The entire call failed
		if (results.length !== batch.length) {
			throw new Error('Redis error: failed to execute batch');
		}

		// A particular command failed
		const errors = results.map(r => r[0]).filter(e => e != null);
		if (errors.length > 0) {
			throw new AggregateError(errors, `Redis error: failed to execute command(s): '${errors.join('\', \'')}'`);
		}

		return results.map(r => r[1]) as RedisResults<Num>;
	}
}

type RedisBatch<Num extends number> = [string, ...unknown[]][] & { length: Num };
type RedisResults<Num extends number> = (string | null)[] & { length: Num };

function createLimitKey(limit: Keyed<RateLimit>, actor: string, subject: string, value: string): string {
	return `rl_${actor}_${limit.key}_${subject}_${value}`;
}

class TransactionError extends Error {}

interface LimitCounter {
	timestamp: number;
	counter: number;
}
