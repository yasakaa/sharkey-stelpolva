/**
 * The Config module contains all the types that Ruffle uses for movie configs.
 *
 * The main interface of interest here is {@link BaseLoadOptions}, which you can apply to `window.RufflePlayer.config`
 * to set the default configuration of all players.
 *
 * @module
 */
export type * from './default.d.ts';
export type * from './load-options.d.ts';
