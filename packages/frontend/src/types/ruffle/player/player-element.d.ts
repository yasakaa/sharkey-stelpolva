import type { LegacyRuffleAPI } from './legacy.d.ts';
import type { FlashAPI } from './flash.d.ts';
/**
 * A Ruffle player's HTML element.
 *
 * This is either created through `window.RufflePlayer.latest().createPlayer()`, or polyfilled from a `<embed>`/`<object>` tag.
 *
 * In addition to usual HTML attributes, this player contains methods and properties that belong to both
 * the **Flash JS API** and **legacy Ruffle API**s.
 */
export interface PlayerElement extends HTMLElement, LegacyRuffleAPI, FlashAPI {
}
