/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { UtilityService } from '@/core/UtilityService.js';
import { IdentifiableError } from '@/misc/identifiable-error.js';
import { toArray } from '@/misc/prelude/array.js';
import { EnvService } from '@/core/EnvService.js';
import { getApId, getOneApHrefNullable, IObject } from './type.js';

@Injectable()
export class ApUtilityService {
	constructor(
		private readonly utilityService: UtilityService,
		private readonly envService: EnvService,
	) {}

	/**
	 * Verifies that the object's ID has the same authority as the provided URL.
	 * Returns on success, throws on any validation error.
	 */
	public assertIdMatchesUrlAuthority(object: IObject, url: string): void {
		// This throws if the ID is missing or invalid, but that's ok.
		// Anonymous objects are impossible to verify, so we don't allow fetching them.
		const id = getApId(object);

		// Make sure the object ID matches the final URL (which is where it actually exists).
		// The caller (ApResolverService) will verify the ID against the original / entry URL, which ensures that all three match.
		if (!this.haveSameAuthority(url, id)) {
			throw new IdentifiableError('fd93c2fa-69a8-440f-880b-bf178e0ec877', `invalid AP object ${url}: id ${id} has different host authority`);
		}
	}

	/**
	 * Checks if two URLs have the same host authority
	 */
	public haveSameAuthority(url1: string, url2: string): boolean {
		if (url1 === url2) return true;

		const authority1 = this.utilityService.punyHostPSLDomain(url1);
		const authority2 = this.utilityService.punyHostPSLDomain(url2);
		return authority1 === authority2;
	}

	/**
	 * Searches a list of URLs or Links for the first one matching a given target URL's host authority.
	 * Returns null if none match.
	 * @param targetUrl URL with the target host authority
	 * @param searchUrls URL, Link, or array to search for matching URLs
	 */
	public findSameAuthorityUrl(targetUrl: string, searchUrls: string | IObject | undefined | (string | IObject)[]): string | null {
		const targetAuthority = this.utilityService.punyHostPSLDomain(targetUrl);

		const match = toArray(searchUrls)
			.map(raw => getOneApHrefNullable(raw))
			.find(url => {
				if (!url) return false;
				if (!this.checkHttps(url)) return false;

				const urlAuthority = this.utilityService.punyHostPSLDomain(url);
				return urlAuthority === targetAuthority;
			});

		return match ?? null;
	}

	/**
	 * Checks if the URL contains HTTPS.
	 * Additionally, allows HTTP in non-production environments.
	 * Based on check-https.ts.
	 */
	private checkHttps(url: string): boolean {
		const isNonProd = this.envService.env.NODE_ENV !== 'production';

		// noinspection HttpUrlsUsage
		return url.startsWith('https://') || (url.startsWith('http://') && isNonProd);
	}
}
