/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { FastifyReply } from 'fastify';
import { LimitInfo } from '@/server/api/SkRateLimiterService.js';

export function sendRateLimitHeaders(reply: FastifyReply, info: LimitInfo): void {
	// Number of seconds until the limit has fully reset.
	reply.header('X-RateLimit-Clear', info.fullResetSec.toString());
	// Number of calls that can be made before being limited.
	reply.header('X-RateLimit-Remaining', info.remaining.toString());

	if (info.blocked) {
		// Number of seconds to wait before trying again. Left for backwards compatibility.
		reply.header('Retry-After', info.resetSec.toString());
		// Number of milliseconds to wait before trying again.
		reply.header('X-RateLimit-Reset', info.resetMs.toString());
	}
}
