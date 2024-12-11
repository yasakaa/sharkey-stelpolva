/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { TimeService } from '@/core/TimeService.js';
import { EnvService } from '@/core/EnvService.js';
import { BucketRateLimit, LegacyRateLimit, LimitInfo, RateLimit, hasMinLimit, isLegacyRateLimit, Keyed, hasMaxLimit, disabledLimitInfo, MaxLegacyLimit, MinLegacyLimit } from '@/misc/rate-limit-utils.js';
import { RedisConnectionPool } from '@/core/RedisConnectionPool.js';
import { TimeoutService } from '@/core/TimeoutService.js';

@Injectable()
export class SkRateLimiterService {
	private readonly disabled: boolean;

	constructor(
		@Inject(TimeService)
		private readonly timeService: TimeService,

		@Inject(TimeoutService)
		private readonly timeoutService: TimeoutService,

		@Inject(RedisConnectionPool)
		private readonly redisPool: RedisConnectionPool,

		@Inject(EnvService)
		envService: EnvService,
	) {
		this.disabled = envService.env.NODE_ENV === 'test';
	}

	public async limit(limit: Keyed<RateLimit>, actor: string, factor = 1): Promise<LimitInfo> {
		if (this.disabled || factor === 0) {
			return disabledLimitInfo;
		}

		if (factor < 0) {
			throw new Error(`Rate limit factor is zero or negative: ${factor}`);
		}

		const redis = await this.redisPool.alloc();
		try {
			return await this.tryLimit(redis, limit, actor, factor);
		} finally {
			await this.redisPool.free(redis);
		}
	}

	private async tryLimit(redis: Redis.Redis, limit: Keyed<RateLimit>, actor: string, factor: number, retry = 0): Promise<LimitInfo> {
		try {
			if (retry > 0) {
				// Real-world testing showed the need for backoff to "spread out" bursty traffic.
				const backoff = Math.round(Math.pow(2, retry + Math.random()));
				await this.timeoutService.delay(backoff);
			}

			if (isLegacyRateLimit(limit)) {
				return await this.limitLegacy(redis, limit, actor, factor);
			} else {
				return await this.limitBucket(redis, limit, actor, factor);
			}
		} catch (err) {
			// We may experience collision errors from optimistic locking.
			// This is expected, so we should retry a few times before giving up.
			// https://redis.io/docs/latest/develop/interact/transactions/#optimistic-locking-using-check-and-set
			if (err instanceof ConflictError && retry < 4) {
				// We can reuse the same connection to reduce pool contention, but we have to reset it first.
				await redis.reset();
				return await this.tryLimit(redis, limit, actor, factor, retry + 1);
			}

			throw err;
		}
	}

	private async limitLegacy(redis: Redis.Redis, limit: Keyed<LegacyRateLimit>, actor: string, factor: number): Promise<LimitInfo> {
		if (hasMaxLimit(limit)) {
			return await this.limitMaxLegacy(redis, limit, actor, factor);
		} else if (hasMinLimit(limit)) {
			return await this.limitMinLegacy(redis, limit, actor, factor);
		} else {
			return disabledLimitInfo;
		}
	}

	private async limitMaxLegacy(redis: Redis.Redis, limit: Keyed<MaxLegacyLimit>, actor: string, factor: number): Promise<LimitInfo> {
		if (limit.duration === 0) return disabledLimitInfo;
		if (limit.duration < 0) throw new Error(`Invalid rate limit ${limit.key}: duration is negative (${limit.duration})`);
		if (limit.max < 1) throw new Error(`Invalid rate limit ${limit.key}: max is less than 1 (${limit.max})`);

		// Derive initial dripRate from minInterval OR duration/max.
		const initialDripRate = Math.max(limit.minInterval ?? Math.round(limit.duration / limit.max), 1);

		// Calculate dripSize to reach max at exactly duration
		const dripSize = Math.max(Math.round(limit.max / (limit.duration / initialDripRate)), 1);

		// Calculate final dripRate from dripSize and duration/max
		const dripRate = Math.max(Math.round(limit.duration / (limit.max / dripSize)), 1);

		const bucketLimit: Keyed<BucketRateLimit> = {
			type: 'bucket',
			key: limit.key,
			size: limit.max,
			dripRate,
			dripSize,
		};
		return await this.limitBucket(redis, bucketLimit, actor, factor);
	}

	private async limitMinLegacy(redis: Redis.Redis, limit: Keyed<MinLegacyLimit>, actor: string, factor: number): Promise<LimitInfo> {
		if (limit.minInterval === 0) return disabledLimitInfo;
		if (limit.minInterval < 0) throw new Error(`Invalid rate limit ${limit.key}: minInterval is negative (${limit.minInterval})`);

		const dripRate = Math.max(Math.round(limit.minInterval), 1);
		const bucketLimit: Keyed<BucketRateLimit> = {
			type: 'bucket',
			key: limit.key,
			size: 1,
			dripRate,
			dripSize: 1,
		};
		return await this.limitBucket(redis, bucketLimit, actor, factor);
	}

	private async limitBucket(redis: Redis.Redis, limit: Keyed<BucketRateLimit>, actor: string, factor: number): Promise<LimitInfo> {
		if (limit.size < 1) throw new Error(`Invalid rate limit ${limit.key}: size is less than 1 (${limit.size})`);
		if (limit.dripRate != null && limit.dripRate < 1) throw new Error(`Invalid rate limit ${limit.key}: dripRate is less than 1 (${limit.dripRate})`);
		if (limit.dripSize != null && limit.dripSize < 1) throw new Error(`Invalid rate limit ${limit.key}: dripSize is less than 1 (${limit.dripSize})`);

		const redisKey = createLimitKey(limit, actor);
		const bucketSize = Math.max(Math.ceil(limit.size / factor), 1);
		const dripRate = Math.ceil(limit.dripRate ?? 1000);
		const dripSize = Math.ceil(limit.dripSize ?? 1);
		const expirationSec = Math.max(Math.ceil(bucketSize / dripRate), 1);

		// Simulate bucket drips
		const counter = await this.getLimitCounter(redis, redisKey);
		if (counter.counter > 0) {
			const dripsSinceLastTick = Math.floor((this.timeService.now - counter.timestamp) / dripRate) * dripSize;
			counter.counter = Math.max(counter.counter - dripsSinceLastTick, 0);
		}

		// Increment the limit, then synchronize with redis
		const blocked = counter.counter >= bucketSize;
		if (!blocked) {
			counter.counter++;
			counter.timestamp = this.timeService.now;
			await this.updateLimitCounter(redis, redisKey, expirationSec, counter);
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

	private async getLimitCounter(redis: Redis.Redis, key: string): Promise<LimitCounter> {
		const counter: LimitCounter = { counter: 0, timestamp: 0 };

		// Watch the key BEFORE reading it!
		await redis.watch(key);
		const data = await redis.get(key);

		// Data may be missing or corrupt if the key doesn't exist.
		// This is an expected edge case.
		if (data) {
			const parts = data.split(':');
			if (parts.length === 2) {
				counter.counter = parseInt(parts[0]);
				counter.timestamp = parseInt(parts[1]);
			}
		}

		return counter;
	}

	private async updateLimitCounter(redis: Redis.Redis, key: string, expirationSec: number, counter: LimitCounter): Promise<void> {
		const data = `${counter.counter}:${counter.timestamp}`;

		await this.executeRedisMulti(
			redis,
			[['set', key, data, 'EX', expirationSec]],
		);
	}

	private async executeRedisMulti<Num extends number>(redis: Redis.Redis, batch: RedisBatch<Num>): Promise<RedisResults<Num>> {
		const results = await redis.multi(batch).exec();

		// Transaction conflict (retryable)
		if (!results) {
			throw new ConflictError('Redis error: transaction conflict');
		}

		// Transaction failed (fatal)
		if (results.length !== batch.length) {
			throw new Error('Redis error: failed to execute batch');
		}

		// Command failed (fatal)
		const errors = results.map(r => r[0]).filter(e => e != null);
		if (errors.length > 0) {
			throw new AggregateError(errors, `Redis error: failed to execute command(s): '${errors.join('\', \'')}'`);
		}

		return results.map(r => r[1]) as RedisResults<Num>;
	}
}

type RedisBatch<Num extends number> = [string, ...unknown[]][] & { length: Num };
type RedisResults<Num extends number> = (string | null)[] & { length: Num };

function createLimitKey(limit: Keyed<RateLimit>, actor: string): string {
	return `rl_${actor}_${limit.key}`;
}

class ConflictError extends Error {}

interface LimitCounter {
	timestamp: number;
	counter: number;
}
