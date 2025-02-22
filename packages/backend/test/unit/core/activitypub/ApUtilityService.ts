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

	describe('findSameAuthorityUrl', () => {
		it('should return null when input is undefined', () => {
			const result = serviceUnderTest.findSameAuthorityUrl('https://example.com', undefined);

			expect(result).toBeNull();
		});

		it('should return null when input is empty array', () => {
			const result = serviceUnderTest.findSameAuthorityUrl('https://example.com', []);

			expect(result).toBeNull();
		});

		it('should return return url if string input matches', () => {
			const result = serviceUnderTest.findSameAuthorityUrl('https://example.com/1', 'https://example.com/2');

			expect(result).toBe('https://example.com/2');
		});

		it('should return return url if object input matches', () => {
			const input = {
				href: 'https://example.com/2',
			} as IObject;

			const result = serviceUnderTest.findSameAuthorityUrl('https://example.com/1', input);

			expect(result).toBe('https://example.com/2');
		});

		it('should return return url if string[] input matches', () => {
			const result = serviceUnderTest.findSameAuthorityUrl('https://example.com/1', ['https://example.com/2']);

			expect(result).toBe('https://example.com/2');
		});

		it('should return return url if object[] input matches', () => {
			const input = {
				href: 'https://example.com/2',
			} as IObject;

			const result = serviceUnderTest.findSameAuthorityUrl('https://example.com/1', [input]);

			expect(result).toBe('https://example.com/2');
		});

		it('should skip invalid entries', () => {
			const result = serviceUnderTest.findSameAuthorityUrl('https://example.com/1', [{} as IObject, 'https://example.com/2']);

			expect(result).toBe('https://example.com/2');
		});

		it('should return first match', () => {
			const result = serviceUnderTest.findSameAuthorityUrl('https://example.com/1', ['https://example.com/2', 'https://example.com/3']);

			expect(result).toBe('https://example.com/2');
		});

		it('should skip invalid scheme', () => {
			const result = serviceUnderTest.findSameAuthorityUrl('https://example.com/1', ['file://example.com/1', 'https://example.com/2']);

			expect(result).toBe('https://example.com/2');
		});

		it('should skip HTTP in production', () => {
			env.NODE_ENV = 'production';

			// noinspection HttpUrlsUsage
			const result = serviceUnderTest.findSameAuthorityUrl('https://example.com/1', ['http://example.com/1', 'https://example.com/2']);

			expect(result).toBe('https://example.com/2');
		});

		it('should allow HTTP in non-prod', () => {
			env.NODE_ENV = 'test';

			// noinspection HttpUrlsUsage
			const result = serviceUnderTest.findSameAuthorityUrl('https://example.com/1', ['http://example.com/1', 'https://example.com/2']);

			// noinspection HttpUrlsUsage
			expect(result).toBe('http://example.com/1');
		});
	});
});
