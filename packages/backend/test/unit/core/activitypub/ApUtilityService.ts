/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { UtilityService } from '@/core/UtilityService.js';
import type { IObject } from '@/core/activitypub/type.js';
import type { EnvService } from '@/core/EnvService.js';
import { ApUtilityService } from '@/core/activitypub/ApUtilityService.js';

describe(ApUtilityService, () => {
	let serviceUnderTest: ApUtilityService;
	let env: Record<string, string>;

	beforeEach(() => {
		const utilityService = {
			punyHostPSLDomain(input: string) {
				const host = new URL(input).host;
				const parts = host.split('.');
				return `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
			},
		} as unknown as UtilityService;

		env = {};
		const envService = {
			env,
		} as unknown as EnvService;

		serviceUnderTest = new ApUtilityService(utilityService, envService);
	});

	describe('assertIdMatchesUrlAuthority', () => {
		it('should return when input matches', () => {
			const object = { id: 'https://first.example.com' } as IObject;
			const url = 'https://second.example.com';

			expect(() => {
				serviceUnderTest.assertIdMatchesUrlAuthority(object, url);
			}).not.toThrow();
		});

		it('should throw when id is missing', () => {
			const object = { id: undefined } as IObject;
			const url = 'https://second.example.com';

			expect(() => {
				serviceUnderTest.assertIdMatchesUrlAuthority(object, url);
			}).toThrow();
		});

		it('should throw when id does not match', () => {
			const object = { id: 'https://other-domain.com' } as IObject;
			const url = 'https://second.example.com';

			expect(() => {
				serviceUnderTest.assertIdMatchesUrlAuthority(object, url);
			}).toThrow();
		});
	});

	describe('haveSameAuthority', () => {
		it('should return true when URLs match', () => {
			const url = 'https://example.com';

			const result = serviceUnderTest.haveSameAuthority(url, url);

			expect(result).toBeTruthy();
		});

		it('should return true when URLs have same host', () => {
			const first = 'https://example.com/first';
			const second = 'https://example.com/second';

			const result = serviceUnderTest.haveSameAuthority(first, second);

			expect(result).toBeTruthy();
		});

		it('should return true when URLs have same authority', () => {
			const first = 'https://first.example.com/first';
			const second = 'https://second.example.com/second';

			const result = serviceUnderTest.haveSameAuthority(first, second);

			expect(result).toBeTruthy();
		});

		it('should return false when URLs have different authority', () => {
			const first = 'https://first.com';
			const second = 'https://second.com';

			const result = serviceUnderTest.haveSameAuthority(first, second);

			expect(result).toBeFalsy();
		});
	});

	describe('findBestObjectUrl', () => {
		it('should return null when input is undefined', () => {
			const object = {
				id: 'https://example.com',
				url: undefined,
			} as IObject;

			const result = serviceUnderTest.findBestObjectUrl(object);

			expect(result).toBeNull();
		});

		it('should return null when input is empty array', () => {
			const object = {
				id: 'https://example.com',
				url: [] as string[],
			} as IObject;

			const result = serviceUnderTest.findBestObjectUrl(object);

			expect(result).toBeNull();
		});

		it('should return return url if string input matches', () => {
			const object = {
				id: 'https://example.com/1',
				url: 'https://example.com/2',
			} as IObject;

			const result = serviceUnderTest.findBestObjectUrl(object);

			expect(result).toBe('https://example.com/2');
		});

		it('should return return url if object input matches', () => {
			const object = {
				id: 'https://example.com/1',
				url: {
					href: 'https://example.com/2',
				} as IObject,
			} as IObject;

			const result = serviceUnderTest.findBestObjectUrl(object);

			expect(result).toBe('https://example.com/2');
		});

		it('should return return url if string[] input matches', () => {
			const object = {
				id: 'https://example.com/1',
				url: ['https://example.com/2'],
			} as IObject;

			const result = serviceUnderTest.findBestObjectUrl(object);

			expect(result).toBe('https://example.com/2');
		});

		it('should return return url if object[] input matches', () => {
			const object = {
				id: 'https://example.com/1',
				url: [{
					href: 'https://example.com/2',
				} as IObject],
			} as IObject;

			const result = serviceUnderTest.findBestObjectUrl(object);

			expect(result).toBe('https://example.com/2');
		});

		it('should skip invalid entries', () => {
			const object = {
				id: 'https://example.com/1',
				url: [{} as IObject, 'https://example.com/2'],
			} as IObject;

			const result = serviceUnderTest.findBestObjectUrl(object);

			expect(result).toBe('https://example.com/2');
		});

		it('should allow empty mediaType', () => {
			const object = {
				id: 'https://example.com/1',
				url: {
					href: 'https://example.com/2',
				} as IObject,
			} as IObject;

			const result = serviceUnderTest.findBestObjectUrl(object);

			expect(result).toBe('https://example.com/2');
		});

		it('should allow text/html mediaType', () => {
			const object = {
				id: 'https://example.com/1',
				url: {
					href: 'https://example.com/2',
					mediaType: 'text/html',
				} as IObject,
			} as IObject;

			const result = serviceUnderTest.findBestObjectUrl(object);

			expect(result).toBe('https://example.com/2');
		});

		it('should allow other text/ mediaTypes', () => {
			const object = {
				id: 'https://example.com/1',
				url: {
					href: 'https://example.com/2',
					mediaType: 'text/imaginary',
				} as IObject,
			} as IObject;

			const result = serviceUnderTest.findBestObjectUrl(object);

			expect(result).toBe('https://example.com/2');
		});

		it('should allow application/ld+json mediaType', () => {
			const object = {
				id: 'https://example.com/1',
				url: {
					href: 'https://example.com/2',
					mediaType: 'application/ld+json;profile=https://www.w3.org/ns/activitystreams',
				} as IObject,
			} as IObject;

			const result = serviceUnderTest.findBestObjectUrl(object);

			expect(result).toBe('https://example.com/2');
		});

		it('should allow application/activity+json mediaType', () => {
			const object = {
				id: 'https://example.com/1',
				url: {
					href: 'https://example.com/2',
					mediaType: 'application/activity+json',
				} as IObject,
			} as IObject;

			const result = serviceUnderTest.findBestObjectUrl(object);

			expect(result).toBe('https://example.com/2');
		});

		it('should reject other mediaTypes', () => {
			const object = {
				id: 'https://example.com/1',
				url: [
					{
						href: 'https://example.com/2',
						mediaType: 'application/json',
					} as IObject,
					{
						href: 'https://example.com/3',
						mediaType: 'image/jpeg',
					} as IObject,
				],
			} as IObject;

			const result = serviceUnderTest.findBestObjectUrl(object);

			expect(result).toBeNull();
		});

		it('should return best match', () => {
			const object = {
				id: 'https://example.com/1',
				url: [
					'https://example.com/2',
					{
						href: 'https://example.com/3',
					} as IObject,
					{
						href: 'https://example.com/4',
						mediaType: 'text/html',
					} as IObject,
					{
						href: 'https://example.com/5',
						mediaType: 'text/plain',
					} as IObject,
					{
						href: 'https://example.com/6',
						mediaType: 'application/ld+json',
					} as IObject,
					{
						href: 'https://example.com/7',
						mediaType: 'application/activity+json',
					} as IObject,
					{
						href: 'https://example.com/8',
						mediaType: 'image/jpeg',
					} as IObject,
				],
			} as IObject;

			const result = serviceUnderTest.findBestObjectUrl(object);

			expect(result).toBe('https://example.com/4');
		});

		it('should return first match in case of ties', () => {
			const object = {
				id: 'https://example.com/1',
				url: ['https://example.com/2', 'https://example.com/3'],
			} as IObject;

			const result = serviceUnderTest.findBestObjectUrl(object);

			expect(result).toBe('https://example.com/2');
		});

		it('should skip invalid scheme', () => {
			const object = {
				id: 'https://example.com/1',
				url: ['file://example.com/1', 'https://example.com/2'],
			} as IObject;

			const result = serviceUnderTest.findBestObjectUrl(object);

			expect(result).toBe('https://example.com/2');
		});

		it('should skip HTTP in production', () => {
			// noinspection HttpUrlsUsage
			const object = {
				id: 'https://example.com/1',
				url: ['http://example.com/1', 'https://example.com/2'],
			} as IObject;
			env.NODE_ENV = 'production';

			const result = serviceUnderTest.findBestObjectUrl(object);

			expect(result).toBe('https://example.com/2');
		});

		it('should allow HTTP in non-prod', () => {
			// noinspection HttpUrlsUsage
			const object = {
				id: 'https://example.com/1',
				url: ['http://example.com/1', 'https://example.com/2'],
			} as IObject;
			env.NODE_ENV = 'test';

			const result = serviceUnderTest.findBestObjectUrl(object);

			// noinspection HttpUrlsUsage
			expect(result).toBe('http://example.com/1');
		});
	});
});
