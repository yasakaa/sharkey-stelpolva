/*
 * SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Provides access to setTimeout, setInterval, and related functions.
 * Used to support deterministic unit testing.
 */
export class TimeoutService {
	/**
	 * Returns a promise that resolves after the specified timeout in milliseconds.
	 */
	public delay(timeout: number): Promise<void> {
		return new Promise(resolve => {
			this.setTimeout(resolve, timeout);
		});
	}

	/**
	 * Passthrough to node's setTimeout
	 */
	public setTimeout(handler: TimeoutHandler, timeout?: number): Timeout {
		return setTimeout(() => handler(), timeout);
	}

	/**
	 * Passthrough to node's setInterval
	 */
	public setInterval(handler: TimeoutHandler, timeout?: number): Timeout {
		return setInterval(() => handler(), timeout);
	}

	/**
	 * Passthrough to node's clearTimeout
	 */
	public clearTimeout(timeout: Timeout) {
		clearTimeout(timeout);
	}

	/**
	 * Passthrough to node's clearInterval
	 */
	public clearInterval(timeout: Timeout) {
		clearInterval(timeout);
	}
}

/**
 * Function to be called when a timer or interval elapses.
 */
export type TimeoutHandler = () => void;

/**
 * A fucked TS issue causes the DOM setTimeout to get merged with Node setTimeout, creating a "quantum method" that returns either "number" or "NodeJS.Timeout" depending on how it's called.
 * This would be fine, except it always matches the *wrong type*!
 * The result is this "impossible" scenario:
 *
 * ```typescript
 * // Test evaluates to "false", because the method's return type is not equal to itself.
 * type Test = ReturnType<typeof setTimeout> extends ReturnType<typeof setTimeout> ? true : false;
 *
 * // This is a compiler error, because the type is broken and triggers some internal TS bug.
 * const timeout = setTimeout(handler);
 * clearTimeout(timeout); // compiler error here, because even type inference doesn't work.
 *
 * // This fails to compile.
 * function test(handler, timeout): ReturnType<typeof setTimeout> {
 *   return setTimeout(handler, timeout);
 * }
 * ```
 *
 * The bug is marked as "wontfix" by TS devs, so we have to work around it ourselves. -_-
 * By forcing the return type to *explicitly* include both types, we at least make it possible to work with the resulting token.
 */
export type Timeout = NodeJS.Timeout | number;
