/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type Redis from 'ioredis';
import { SkRateLimiterService } from '@/server/api/SkRateLimiterService.js';
import { BucketRateLimit, Keyed, LegacyRateLimit } from '@/misc/rate-limit-utils.js';

/* eslint-disable @typescript-eslint/no-non-null-assertion */

describe(SkRateLimiterService, () => {
	let mockTimeService: { now: number, date: Date } = null!;
	let mockRedis: Array<(command: [string, ...unknown[]]) => [Error | null, unknown] | null> = null!;
	let mockRedisExec: (batch: [string, ...unknown[]][]) => Promise<[Error | null, unknown][] | null> = null!;
	let mockEnvironment: Record<string, string | undefined> = null!;
	let serviceUnderTest: () => SkRateLimiterService = null!;

	beforeEach(() => {
		mockTimeService = {
			now: 0,
			get date() {
				return new Date(mockTimeService.now);
			},
		};

		mockRedis = [];
		mockRedisExec = (batch) => {
			const results: [Error | null, unknown][] = batch.map(command => {
				const handlerResults = mockRedis.map(handler => handler(command));
				const finalResult = handlerResults.findLast(result => result != null);
				return finalResult ?? [new Error('test error: no handler'), null];
			});
			return Promise.resolve(results);
		};
		const mockRedisClient = {
			multi(batch: [string, ...unknown[]][]) {
				return {
					watch() {
						return {
							exec() {
								return mockRedisExec(batch);
							},
						};
					},
				};
			},
		} as unknown as Redis.Redis;

		mockEnvironment = Object.create(process.env);
		mockEnvironment.NODE_ENV = 'production';
		const mockEnvService = {
			env: mockEnvironment,
		};

		let service: SkRateLimiterService | undefined = undefined;
		serviceUnderTest = () => {
			return service ??= new SkRateLimiterService(mockTimeService, mockRedisClient, mockEnvService);
		};
	});

	describe('limit', () => {
		const actor = 'actor';
		const key = 'test';

		let limitCounter: number | undefined = undefined;
		let limitTimestamp: number | undefined = undefined;
		let minCounter: number | undefined = undefined;
		let minTimestamp: number | undefined = undefined;

		beforeEach(() => {
			limitCounter = undefined;
			limitTimestamp = undefined;
			minCounter = undefined;
			minTimestamp = undefined;

			mockRedis.push(([command, ...args]) => {
				if (command === 'set' && args[0] === 'rl_actor_test_bucket_t') {
					limitTimestamp = parseInt(args[1] as string);
					return [null, args[1]];
				}
				if (command === 'get' && args[0] === 'rl_actor_test_bucket_t') {
					return [null, limitTimestamp?.toString() ?? null];
				}
				// if (command === 'incr' && args[0] === 'rl_actor_test_bucket_c') {
				// 	limitCounter = (limitCounter ?? 0) + 1;
				// 	return [null, null];
				// }
				if (command === 'set' && args[0] === 'rl_actor_test_bucket_c') {
					limitCounter = parseInt(args[1] as string);
					return [null, args[1]];
				}
				if (command === 'get' && args[0] === 'rl_actor_test_bucket_c') {
					return [null, limitCounter?.toString() ?? null];
				}

				if (command === 'set' && args[0] === 'rl_actor_test_min_t') {
					minTimestamp = parseInt(args[1] as string);
					return [null, args[1]];
				}
				if (command === 'get' && args[0] === 'rl_actor_test_min_t') {
					return [null, minTimestamp?.toString() ?? null];
				}
				// if (command === 'incr' && args[0] === 'rl_actor_test_min_c') {
				// 	minCounter = (minCounter ?? 0) + 1;
				// 	return [null, null];
				// }
				if (command === 'set' && args[0] === 'rl_actor_test_min_c') {
					minCounter = parseInt(args[1] as string);
					return [null, args[1]];
				}
				if (command === 'get' && args[0] === 'rl_actor_test_min_c') {
					return [null, minCounter?.toString() ?? null];
				}
				// if (command === 'expire') {
				// 	return [null, null];
				// }

				return null;
			});
		});

		it('should bypass in test environment', async () => {
			mockEnvironment.NODE_ENV = 'test';

			const info = await serviceUnderTest().limit({ key: 'l', type: undefined, max: 0 }, actor);

			expect(info.blocked).toBeFalsy();
			expect(info.remaining).toBe(Number.MAX_SAFE_INTEGER);
			expect(info.resetSec).toBe(0);
			expect(info.resetMs).toBe(0);
			expect(info.fullResetSec).toBe(0);
			expect(info.fullResetMs).toBe(0);
		});

		describe('with bucket limit', () => {
			let limit: Keyed<BucketRateLimit> = null!;

			beforeEach(() => {
				limit = {
					type: 'bucket',
					key: 'test',
					size: 1,
				};
			});

			it('should allow when limit is not reached', async () => {
				const info = await serviceUnderTest().limit(limit, actor);

				expect(info.blocked).toBeFalsy();
			});

			it('should return correct info when allowed', async () => {
				limit.size = 2;
				limitCounter = 1;
				limitTimestamp = 0;

				const info = await serviceUnderTest().limit(limit, actor);

				expect(info.remaining).toBe(0);
				expect(info.resetSec).toBe(1);
				expect(info.resetMs).toBe(1000);
				expect(info.fullResetSec).toBe(2);
				expect(info.fullResetMs).toBe(2000);
			});

			it('should increment counter when called', async () => {
				await serviceUnderTest().limit(limit, actor);

				expect(limitCounter).toBe(1);
			});

			it('should set timestamp when called', async () => {
				mockTimeService.now = 1000;

				await serviceUnderTest().limit(limit, actor);

				expect(limitTimestamp).toBe(1000);
			});

			it('should decrement counter when dripRate has passed', async () => {
				limitCounter = 2;
				limitTimestamp = 0;
				mockTimeService.now = 2000;

				await serviceUnderTest().limit(limit, actor);

				expect(limitCounter).toBe(1); // 2 (starting) - 2 (2x1 drip) + 1 (call) = 1
			});

			it('should decrement counter by dripSize', async () => {
				limitCounter = 2;
				limitTimestamp = 0;
				limit.dripSize = 2;
				mockTimeService.now = 1000;

				await serviceUnderTest().limit(limit, actor);

				expect(limitCounter).toBe(1); // 2 (starting) - 2 (1x2 drip) + 1 (call) = 1
			});

			it('should maintain counter between calls over time', async () => {
				limit.size = 5;

				await serviceUnderTest().limit(limit, actor); // 0 + 1 = 1
				mockTimeService.now += 1000; // 1 - 1 = 0
				await serviceUnderTest().limit(limit, actor); // 0 + 1 = 1
				await serviceUnderTest().limit(limit, actor); // 1 + 1 = 2
				await serviceUnderTest().limit(limit, actor); // 2 + 1 = 3
				mockTimeService.now += 1000; // 3 - 1 = 2
				mockTimeService.now += 1000; // 2 - 1 = 1
				await serviceUnderTest().limit(limit, actor); // 1 + 1 = 2

				expect(limitCounter).toBe(2);
				expect(limitTimestamp).toBe(3000);
			});

			it('should block when bucket is filled', async () => {
				limitCounter = 1;
				limitTimestamp = 0;

				const info = await serviceUnderTest().limit(limit, actor);

				expect(info.blocked).toBeTruthy();
			});

			it('should calculate correct info when blocked', async () => {
				limitCounter = 1;
				limitTimestamp = 0;

				const info = await serviceUnderTest().limit(limit, actor);

				expect(info.resetSec).toBe(1);
				expect(info.resetMs).toBe(1000);
				expect(info.fullResetSec).toBe(1);
				expect(info.fullResetMs).toBe(1000);
			});

			it('should allow when bucket is filled but should drip', async () => {
				limitCounter = 1;
				limitTimestamp = 0;
				mockTimeService.now = 1000;

				const info = await serviceUnderTest().limit(limit, actor);

				expect(info.blocked).toBeFalsy();
			});

			it('should scale limit by factor', async () => {
				limitCounter = 1;
				limitTimestamp = 0;

				const i1 = await serviceUnderTest().limit(limit, actor, 0.5); // 1 + 1 = 2
				const i2 = await serviceUnderTest().limit(limit, actor, 0.5); // 2 + 1 = 3

				expect(i1.blocked).toBeFalsy();
				expect(i2.blocked).toBeTruthy();
			});

			it('should set counter expiration', async () => {
				const commands: unknown[][] = [];
				mockRedis.push(command => {
					commands.push(command);
					return null;
				});

				await serviceUnderTest().limit(limit, actor);

				expect(commands).toContainEqual(['set', 'rl_actor_test_bucket_c', '1', 'EX', 1]);
			});

			it('should set timestamp expiration', async () => {
				const commands: unknown[][] = [];
				mockRedis.push(command => {
					commands.push(command);
					return null;
				});

				await serviceUnderTest().limit(limit, actor);

				expect(commands).toContainEqual(['set', 'rl_actor_test_bucket_t', '0', 'EX', 1]);
			});

			it('should not increment when already blocked', async () => {
				limitCounter = 1;
				limitTimestamp = 0;
				mockTimeService.now += 100;

				await serviceUnderTest().limit(limit, actor);

				expect(limitCounter).toBe(1);
				expect(limitTimestamp).toBe(0);
			});

			it('should skip if factor is zero', async () => {
				const info = await serviceUnderTest().limit(limit, actor, 0);

				expect(info.blocked).toBeFalsy();
				expect(info.remaining).toBe(Number.MAX_SAFE_INTEGER);
			});

			it('should throw if factor is negative', async () => {
				const promise = serviceUnderTest().limit(limit, actor, -1);

				await expect(promise).rejects.toThrow(/factor is zero or negative/);
			});

			it('should throw if size is zero', async () => {
				limit.size = 0;

				const promise = serviceUnderTest().limit(limit, actor);

				await expect(promise).rejects.toThrow(/size is less than 1/);
			});

			it('should throw if size is negative', async () => {
				limit.size = -1;

				const promise = serviceUnderTest().limit(limit, actor);

				await expect(promise).rejects.toThrow(/size is less than 1/);
			});

			it('should throw if size is fraction', async () => {
				limit.size = 0.5;

				const promise = serviceUnderTest().limit(limit, actor);

				await expect(promise).rejects.toThrow(/size is less than 1/);
			});

			it('should throw if dripRate is zero', async () => {
				limit.dripRate = 0;

				const promise = serviceUnderTest().limit(limit, actor);

				await expect(promise).rejects.toThrow(/dripRate is less than 1/);
			});

			it('should throw if dripRate is negative', async () => {
				limit.dripRate = -1;

				const promise = serviceUnderTest().limit(limit, actor);

				await expect(promise).rejects.toThrow(/dripRate is less than 1/);
			});

			it('should throw if dripRate is fraction', async () => {
				limit.dripRate = 0.5;

				const promise = serviceUnderTest().limit(limit, actor);

				await expect(promise).rejects.toThrow(/dripRate is less than 1/);
			});

			it('should throw if dripSize is zero', async () => {
				limit.dripSize = 0;

				const promise = serviceUnderTest().limit(limit, actor);

				await expect(promise).rejects.toThrow(/dripSize is less than 1/);
			});

			it('should throw if dripSize is negative', async () => {
				limit.dripSize = -1;

				const promise = serviceUnderTest().limit(limit, actor);

				await expect(promise).rejects.toThrow(/dripSize is less than 1/);
			});

			it('should throw if dripSize is fraction', async () => {
				limit.dripSize = 0.5;

				const promise = serviceUnderTest().limit(limit, actor);

				await expect(promise).rejects.toThrow(/dripSize is less than 1/);
			});

			it('should retry when redis conflicts', async () => {
				let numCalls = 0;
				const realMockRedisExec = mockRedisExec;
				mockRedisExec = () => {
					if (numCalls > 0) {
						mockRedisExec = realMockRedisExec;
					}
					numCalls++;
					return Promise.resolve(null);
				};

				await serviceUnderTest().limit(limit, actor);

				expect(numCalls).toBe(2);
			});

			it('should bail out after 3 tries', async () => {
				let numCalls = 0;
				mockRedisExec = () => {
					numCalls++;
					return Promise.resolve(null);
				};

				const promise = serviceUnderTest().limit(limit, actor);

				await expect(promise).rejects.toThrow(/transaction conflict/);
				expect(numCalls).toBe(3);
			});

			it('should apply correction if extra calls slip through', async () => {
				limitCounter = 2;

				const info = await serviceUnderTest().limit(limit, actor);

				expect(info.blocked).toBeTruthy();
				expect(info.remaining).toBe(0);
				expect(info.resetMs).toBe(2000);
				expect(info.resetSec).toBe(2);
				expect(info.fullResetMs).toBe(2000);
				expect(info.fullResetSec).toBe(2);
			});
		});

		describe('with min interval', () => {
			let limit: Keyed<LegacyRateLimit> = null!;

			beforeEach(() => {
				limit = {
					type: undefined,
					key,
					minInterval: 1000,
				};
			});

			it('should allow when limit is not reached', async () => {
				const info = await serviceUnderTest().limit(limit, actor);

				expect(info.blocked).toBeFalsy();
			});

			it('should calculate correct info when allowed', async () => {
				const info = await serviceUnderTest().limit(limit, actor);

				expect(info.remaining).toBe(0);
				expect(info.resetSec).toBe(1);
				expect(info.resetMs).toBe(1000);
				expect(info.fullResetSec).toBe(1);
				expect(info.fullResetMs).toBe(1000);
			});

			it('should increment counter when called', async () => {
				await serviceUnderTest().limit(limit, actor);

				expect(minCounter).not.toBeUndefined();
				expect(minCounter).toBe(1);
			});

			it('should set timestamp when called', async () => {
				mockTimeService.now = 1000;

				await serviceUnderTest().limit(limit, actor);

				expect(minCounter).not.toBeUndefined();
				expect(minTimestamp).toBe(1000);
			});

			it('should decrement counter when minInterval has passed', async () => {
				minCounter = 1;
				minTimestamp = 0;
				mockTimeService.now = 1000;

				await serviceUnderTest().limit(limit, actor);

				expect(minCounter).not.toBeUndefined();
				expect(minCounter).toBe(1); // 1 (starting) - 1 (interval) + 1 (call) = 1
			});

			it('should reset counter entirely', async () => {
				minCounter = 2;
				minTimestamp = 0;
				mockTimeService.now = 1000;

				await serviceUnderTest().limit(limit, actor);

				expect(minCounter).not.toBeUndefined();
				expect(minCounter).toBe(1); // 2 (starting) - 2 (interval) + 1 (call) = 1
			});

			it('should maintain counter between calls over time', async () => {
				await serviceUnderTest().limit(limit, actor); // 0 + 1 = 1
				mockTimeService.now += 1000; // 1 - 1 = 0
				await serviceUnderTest().limit(limit, actor); // 0 + 1 = 1
				await serviceUnderTest().limit(limit, actor); // blocked
				await serviceUnderTest().limit(limit, actor); // blocked
				mockTimeService.now += 1000; // 1 - 1 = 0
				mockTimeService.now += 1000; // 0 - 1 = 0
				await serviceUnderTest().limit(limit, actor); // 0 + 1 = 1

				expect(minCounter).toBe(1);
				expect(minTimestamp).toBe(3000);
			});

			it('should block when interval exceeded', async () => {
				minCounter = 1;
				minTimestamp = 0;

				const info = await serviceUnderTest().limit(limit, actor);

				expect(info.blocked).toBeTruthy();
			});

			it('should calculate correct info when blocked', async () => {
				minCounter = 1;
				minTimestamp = 0;

				const info = await serviceUnderTest().limit(limit, actor);

				expect(info.resetSec).toBe(1);
				expect(info.resetMs).toBe(1000);
				expect(info.fullResetSec).toBe(1);
				expect(info.fullResetMs).toBe(1000);
			});

			it('should allow when bucket is filled but interval has passed', async () => {
				minCounter = 1;
				minTimestamp = 0;
				mockTimeService.now = 1000;

				const info = await serviceUnderTest().limit(limit, actor);

				expect(info.blocked).toBeFalsy();
			});

			it('should scale interval by factor', async () => {
				minCounter = 1;
				minTimestamp = 0;
				mockTimeService.now += 500;

				const info = await serviceUnderTest().limit(limit, actor, 0.5);

				expect(info.blocked).toBeFalsy();
			});

			it('should set counter expiration', async () => {
				const commands: unknown[][] = [];
				mockRedis.push(command => {
					commands.push(command);
					return null;
				});

				await serviceUnderTest().limit(limit, actor);

				expect(commands).toContainEqual(['set', 'rl_actor_test_min_c', '1', 'EX', 1]);
			});

			it('should set timestamp expiration', async () => {
				const commands: unknown[][] = [];
				mockRedis.push(command => {
					commands.push(command);
					return null;
				});

				await serviceUnderTest().limit(limit, actor);

				expect(commands).toContainEqual(['set', 'rl_actor_test_min_t', '0', 'EX', 1]);
			});

			it('should not increment when already blocked', async () => {
				minCounter = 1;
				minTimestamp = 0;
				mockTimeService.now += 100;

				await serviceUnderTest().limit(limit, actor);

				expect(minCounter).toBe(1);
				expect(minTimestamp).toBe(0);
			});

			it('should skip if factor is zero', async () => {
				const info = await serviceUnderTest().limit(limit, actor, 0);

				expect(info.blocked).toBeFalsy();
				expect(info.remaining).toBe(Number.MAX_SAFE_INTEGER);
			});

			it('should throw if factor is negative', async () => {
				const promise = serviceUnderTest().limit(limit, actor, -1);

				await expect(promise).rejects.toThrow(/factor is zero or negative/);
			});

			it('should skip if minInterval is zero', async () => {
				limit.minInterval = 0;

				const info = await serviceUnderTest().limit(limit, actor);

				expect(info.blocked).toBeFalsy();
				expect(info.remaining).toBe(Number.MAX_SAFE_INTEGER);
			});

			it('should throw if minInterval is negative', async () => {
				limit.minInterval = -1;

				const promise = serviceUnderTest().limit(limit, actor);

				await expect(promise).rejects.toThrow(/minInterval is negative/);
			});

			it('should not apply correction to extra calls', async () => {
				minCounter = 2;

				const info = await serviceUnderTest().limit(limit, actor);

				expect(info.blocked).toBeTruthy();
				expect(info.remaining).toBe(0);
				expect(info.resetMs).toBe(1000);
				expect(info.resetSec).toBe(1);
				expect(info.fullResetMs).toBe(1000);
				expect(info.fullResetSec).toBe(1);
			});
		});

		describe('with legacy limit', () => {
			let limit: Keyed<LegacyRateLimit> = null!;

			beforeEach(() => {
				limit = {
					type: undefined,
					key,
					max: 1,
					duration: 1000,
				};
			});

			it('should allow when limit is not reached', async () => {
				const info = await serviceUnderTest().limit(limit, actor);

				expect(info.blocked).toBeFalsy();
			});

			it('should infer dripRate from duration', async () => {
				limit.max = 10;
				limit.duration = 10000;
				limitCounter = 10;
				limitTimestamp = 0;

				const i1 = await serviceUnderTest().limit(limit, actor);
				mockTimeService.now += 1000;
				const i2 = await serviceUnderTest().limit(limit, actor);
				mockTimeService.now += 2000;
				const i3 = await serviceUnderTest().limit(limit, actor);
				const i4 = await serviceUnderTest().limit(limit, actor);
				const i5 = await serviceUnderTest().limit(limit, actor);
				mockTimeService.now += 2000;
				const i6 = await serviceUnderTest().limit(limit, actor);

				expect(i1.blocked).toBeTruthy();
				expect(i2.blocked).toBeFalsy();
				expect(i3.blocked).toBeFalsy();
				expect(i4.blocked).toBeFalsy();
				expect(i5.blocked).toBeTruthy();
				expect(i6.blocked).toBeFalsy();
			});

			it('should calculate correct info when allowed', async () => {
				limit.max = 10;
				limit.duration = 10000;
				limitCounter = 10;
				limitTimestamp = 0;
				mockTimeService.now += 2000;

				const info = await serviceUnderTest().limit(limit, actor);

				expect(info.remaining).toBe(1);
				expect(info.resetSec).toBe(0);
				expect(info.resetMs).toBe(0);
				expect(info.fullResetSec).toBe(9);
				expect(info.fullResetMs).toBe(9000);
			});

			it('should calculate correct info when blocked', async () => {
				limit.max = 10;
				limit.duration = 10000;
				limitCounter = 10;
				limitTimestamp = 0;

				const info = await serviceUnderTest().limit(limit, actor);

				expect(info.remaining).toBe(0);
				expect(info.resetSec).toBe(1);
				expect(info.resetMs).toBe(1000);
				expect(info.fullResetSec).toBe(10);
				expect(info.fullResetMs).toBe(10000);
			});

			it('should allow when bucket is filled but interval has passed', async () => {
				limitCounter = 10;
				limitTimestamp = 0;
				mockTimeService.now = 1000;

				const info = await serviceUnderTest().limit(limit, actor);

				expect(info.blocked).toBeTruthy();
			});

			it('should scale limit by factor', async () => {
				limitCounter = 10;
				limitTimestamp = 0;

				const info = await serviceUnderTest().limit(limit, actor, 0.5); // 10 + 1 = 11

				expect(info.blocked).toBeTruthy();
			});

			it('should set counter expiration', async () => {
				const commands: unknown[][] = [];
				mockRedis.push(command => {
					commands.push(command);
					return null;
				});

				await serviceUnderTest().limit(limit, actor);

				expect(commands).toContainEqual(['set', 'rl_actor_test_bucket_c', '1', 'EX', 1]);
			});

			it('should set timestamp expiration', async () => {
				const commands: unknown[][] = [];
				mockRedis.push(command => {
					commands.push(command);
					return null;
				});

				await serviceUnderTest().limit(limit, actor);

				expect(commands).toContainEqual(['set', 'rl_actor_test_bucket_t', '0', 'EX', 1]);
			});

			it('should not increment when already blocked', async () => {
				limitCounter = 1;
				limitTimestamp = 0;
				mockTimeService.now += 100;

				await serviceUnderTest().limit(limit, actor);

				expect(limitCounter).toBe(1);
				expect(limitTimestamp).toBe(0);
			});

			it('should not allow dripRate to be lower than 0', async () => {
				// real-world case; taken from StreamingApiServerService
				limit.max = 4096;
				limit.duration = 2000;
				limitCounter = 4096;
				limitTimestamp = 0;

				const i1 = await serviceUnderTest().limit(limit, actor);
				mockTimeService.now = 1;
				const i2 = await serviceUnderTest().limit(limit, actor);

				expect(i1.blocked).toBeTruthy();
				expect(i2.blocked).toBeFalsy();
			});

			it('should skip if factor is zero', async () => {
				const info = await serviceUnderTest().limit(limit, actor, 0);

				expect(info.blocked).toBeFalsy();
				expect(info.remaining).toBe(Number.MAX_SAFE_INTEGER);
			});

			it('should throw if factor is negative', async () => {
				const promise = serviceUnderTest().limit(limit, actor, -1);

				await expect(promise).rejects.toThrow(/factor is zero or negative/);
			});

			it('should throw if max is zero', async () => {
				limit.max = 0;

				const promise = serviceUnderTest().limit(limit, actor);

				await expect(promise).rejects.toThrow(/size is less than 1/);
			});

			it('should throw if max is negative', async () => {
				limit.max = -1;

				const promise = serviceUnderTest().limit(limit, actor);

				await expect(promise).rejects.toThrow(/size is less than 1/);
			});

			it('should apply correction if extra calls slip through', async () => {
				limitCounter = 2;

				const info = await serviceUnderTest().limit(limit, actor);

				expect(info.blocked).toBeTruthy();
				expect(info.remaining).toBe(0);
				expect(info.resetMs).toBe(2000);
				expect(info.resetSec).toBe(2);
				expect(info.fullResetMs).toBe(2000);
				expect(info.fullResetSec).toBe(2);
			});
		});

		describe('with legacy limit and min interval', () => {
			let limit: Keyed<LegacyRateLimit> = null!;

			beforeEach(() => {
				limit = {
					type: undefined,
					key,
					max: 5,
					duration: 5000,
					minInterval: 1000,
				};
			});

			it('should allow when limit is not reached', async () => {
				const info = await serviceUnderTest().limit(limit, actor);

				expect(info.blocked).toBeFalsy();
			});

			it('should block when limit exceeded', async () => {
				limitCounter = 5;
				limitTimestamp = 0;

				const info = await serviceUnderTest().limit(limit, actor);

				expect(info.blocked).toBeTruthy();
			});

			it('should block when minInterval exceeded', async () => {
				minCounter = 1;
				minTimestamp = 0;

				const info = await serviceUnderTest().limit(limit, actor);

				expect(info.blocked).toBeTruthy();
			});

			it('should calculate correct info when allowed', async () => {
				limitCounter = 1;
				limitTimestamp = 0;

				const info = await serviceUnderTest().limit(limit, actor);

				expect(info.remaining).toBe(0);
				expect(info.resetSec).toBe(1);
				expect(info.resetMs).toBe(1000);
				expect(info.fullResetSec).toBe(2);
				expect(info.fullResetMs).toBe(2000);
			});

			it('should calculate correct info when blocked by limit', async () => {
				limitCounter = 5;
				limitTimestamp = 0;

				const info = await serviceUnderTest().limit(limit, actor);

				expect(info.remaining).toBe(0);
				expect(info.resetSec).toBe(1);
				expect(info.resetMs).toBe(1000);
				expect(info.fullResetSec).toBe(5);
				expect(info.fullResetMs).toBe(5000);
			});

			it('should calculate correct info when blocked by minInterval', async () => {
				minCounter = 1;
				minTimestamp = 0;

				const info = await serviceUnderTest().limit(limit, actor);

				expect(info.remaining).toBe(0);
				expect(info.resetSec).toBe(1);
				expect(info.resetMs).toBe(1000);
				expect(info.fullResetSec).toBe(1);
				expect(info.fullResetMs).toBe(1000);
			});

			it('should allow when counter is filled but interval has passed', async () => {
				limitCounter = 5;
				limitTimestamp = 0;
				mockTimeService.now = 1000;

				const info = await serviceUnderTest().limit(limit, actor);

				expect(info.blocked).toBeFalsy();
			});

			it('should allow when minCounter is filled but interval has passed', async () => {
				minCounter = 1;
				minTimestamp = 0;
				mockTimeService.now = 1000;

				const info = await serviceUnderTest().limit(limit, actor);

				expect(info.blocked).toBeFalsy();
			});

			it('should scale limit and interval by factor', async () => {
				limitCounter = 5;
				limitTimestamp = 0;
				minCounter = 1;
				minTimestamp = 0;
				mockTimeService.now += 500;

				const info = await serviceUnderTest().limit(limit, actor, 0.5);

				expect(info.blocked).toBeFalsy();
			});

			it('should set bucket counter expiration', async () => {
				const commands: unknown[][] = [];
				mockRedis.push(command => {
					commands.push(command);
					return null;
				});

				await serviceUnderTest().limit(limit, actor);

				expect(commands).toContainEqual(['set', 'rl_actor_test_bucket_c', '1', 'EX', 1]);
			});

			it('should set bucket timestamp expiration', async () => {
				const commands: unknown[][] = [];
				mockRedis.push(command => {
					commands.push(command);
					return null;
				});

				await serviceUnderTest().limit(limit, actor);

				expect(commands).toContainEqual(['set', 'rl_actor_test_bucket_t', '0', 'EX', 1]);
			});

			it('should set min counter expiration', async () => {
				const commands: unknown[][] = [];
				mockRedis.push(command => {
					commands.push(command);
					return null;
				});

				await serviceUnderTest().limit(limit, actor);

				expect(commands).toContainEqual(['set', 'rl_actor_test_min_c', '1', 'EX', 1]);
			});

			it('should set min timestamp expiration', async () => {
				const commands: unknown[][] = [];
				mockRedis.push(command => {
					commands.push(command);
					return null;
				});

				await serviceUnderTest().limit(limit, actor);

				expect(commands).toContainEqual(['set', 'rl_actor_test_min_t', '0', 'EX', 1]);
			});

			it('should not increment when already blocked', async () => {
				limitCounter = 5;
				limitTimestamp = 0;
				minCounter = 1;
				minTimestamp = 0;
				mockTimeService.now += 100;

				await serviceUnderTest().limit(limit, actor);

				expect(limitCounter).toBe(5);
				expect(limitTimestamp).toBe(0);
				expect(minCounter).toBe(1);
				expect(minTimestamp).toBe(0);
			});

			it('should apply correction if extra calls slip through', async () => {
				limitCounter = 6;
				minCounter = 6;

				const info = await serviceUnderTest().limit(limit, actor);

				expect(info.blocked).toBeTruthy();
				expect(info.remaining).toBe(0);
				expect(info.resetMs).toBe(2000);
				expect(info.resetSec).toBe(2);
				expect(info.fullResetMs).toBe(6000);
				expect(info.fullResetSec).toBe(6);
			});
		});
	});
});
