<!--
SPDX-FileCopyrightText: marie and other Sharkey contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div v-if="hide" class="flash-player-disabled height-hack" @click="toggleVisible()">
	<div>
		<b><i class="ph-eye ph-bold ph-lg"></i> {{ i18n.ts.sensitive }}</b>
		<span>{{ i18n.ts.clickToShow }}</span>
	</div>
</div>

<div v-else class="flash-player-enabled height-hack">
	<div class="flash-display">
		<div v-if="playerHide" class="player-hide" @click="dismissWarning()">
			<b><i class="ph-eye ph-bold ph-lg"></i> Flash Content Hidden</b>
			<span>Powered by Ruffle.</span>
			<span>Always be wary of arbitrary code execution!</span>
			<span>{{ i18n.ts.clickToShow }}</span>
		</div>
		<div v-if="ruffleError" class="player-hide">
			<b><i class="ph-warning ph-bold ph-lg"></i> Flash Content Failed To Load:</b>
			<code>{{ ruffleError }}</code>
		</div>
		<div v-else-if="loadingStatus" class="player-hide">
			<b>Flash Content Is Loading<MkEllipsis/></b>
			<MkLoading/>
			<p>{{ loadingStatus }}</p>
		</div>
		<div ref="ruffleContainer" class="container"></div>
	</div>
	<div class="controls">
		<button class="play" @click="playPause()">
			<i v-if="player?.isPlaying" class="ph-pause ph-bold ph-lg"></i> <!-- FIXME: Broken? (Though less so than before) -->
			<i v-else class="ph-play ph-bold ph-lg"></i>
		</button>
		<button class="stop" @click="stop()">
			<i class="ph-stop ph-bold ph-lg"></i>
		</button>
		<input v-if="player" v-model="player.volume" type="range" min="0" max="1" step="0.1"/>
		<input v-else type="range" min="0" max="1" value="1" disabled/>
		<a class="download" :title="i18n.ts.download" :href="flashFile.url" target="_blank">
			<i class="ph-download ph-bold ph-lg"></i>
		</a>
		<button class="fullscreen" @click="fullscreen()">
			<i class="ph-arrows-out ph-bold ph-lg"></i>
		</button>
	</div>
	<div v-if="flashFile.comment" class="alt" :title="comment">ALT</div>
	<i class="hide ph-eye-slash ph-bold ph-lg" @click="toggleVisible()"></i>
</div>
</template>

<script lang="ts" setup>
import { ref, computed, onDeactivated } from 'vue';
import * as Misskey from 'misskey-js';
import packageInfo from '../../package.json';
import MkEllipsis from './global/MkEllipsis.vue';
import MkLoading from './global/MkLoading.vue';
import { i18n } from '@/i18n.js';
import { defaultStore } from '@/store.js';
import { PublicAPI, PublicAPILike } from '@/types/ruffle/setup'; // This gives us the types for window.RufflePlayer, etc via side effects
import { PlayerElement } from '@/types/ruffle/player';

const props = defineProps<{
	flashFile: Misskey.entities.DriveFile
}>();

const isSensitive = computed(() => { return props.flashFile.isSensitive; });
const url = computed(() => { return props.flashFile.url; });
const comment = computed(() => { return props.flashFile.comment ?? ''; });
let hide = ref((defaultStore.state.nsfw === 'force') ? true : isSensitive.value && (defaultStore.state.nsfw !== 'ignore'));
let playerHide = ref(true);
let ruffleContainer = ref<HTMLDivElement>();
let loadingStatus = ref<string | undefined>(undefined);
let player = ref<PlayerElement | undefined>(undefined);
let ruffleError = ref<string | undefined>(undefined);

function dismissWarning() {
	playerHide.value = false;
	loadRuffle().then(() => {
		try {
			createPlayer();
			loadContent();
		} catch (error) {
			handleError(error);
		}
	}).catch(handleError);
}

function handleError(error: unknown) {
	if (error instanceof Error) ruffleError.value = error.stack;
	else ruffleError.value = `${error}`; // Fallback for if something is horribly wrong
}

/**
 * @throws if unpkg shits itself
 */
async function loadRuffle() {
	if (window.RufflePlayer !== undefined) return;
	loadingStatus.value = 'Loading Ruffle player';
	await import('@ruffle-rs/ruffle'); // Assumption: this will throw if unpkg has a hiccup or something. If not, the next undefined check will catch it.
	window.RufflePlayer = window.RufflePlayer as PublicAPILike | PublicAPI | undefined; // Assert unknown type due to side effects
	if (window.RufflePlayer === undefined) throw Error('unpkg has shit itself, but not in an expected way (has unpkg permanently shut down? how close is the heat death of the universe?)');

	window.RufflePlayer.config = {
		// Options affecting the whole page
		'publicPath': `https://unpkg.com/@ruffle-rs/ruffle@${packageInfo.dependencies['@ruffle-rs/ruffle']}/`,
		'polyfills': false,

		// Options affecting files only
		'allowScriptAccess': false,
		'autoplay': true,
		'unmuteOverlay': 'visible',
		'backgroundColor': null,
		'wmode': 'window',
		'letterbox': 'on',
		'warnOnUnsupportedContent': true,
		'contextMenu': 'off', // Prevent two overlapping context menus. Most of the stuff in this context menu is available in the controls below the player.
		'showSwfDownload': false, // Handled by custom download button
		'upgradeToHttps': window.location.protocol === 'https:',
		'maxExecutionDuration': 15,
		'logLevel': 'error',
		'base': null,
		'menu': true,
		'salign': '',
		'forceAlign': false,
		'scale': 'showAll',
		'forceScale': false,
		'frameRate': null,
		'quality': 'high',
		'splashScreen': false,
		'preferredRenderer': null,
		'openUrlMode': 'allow',
		'allowNetworking': 'all',
		'favorFlash': true,
		'socketProxy': [],
		'fontSources': [],
		'defaultFonts': {},
		'credentialAllowList': [],
		'playerRuntime': 'flashPlayer',
		'allowFullscreen': false, // Handled by custom fullscreen button
	};
}

/**
 * @throws If `ruffle.newest()` fails (impossible)
 */
function createPlayer() {
	if (player.value !== undefined) return;
	const ruffle = (() => {
		const ruffleAPI = (window.RufflePlayer as PublicAPI).newest();
		if (ruffleAPI === null) {
			// This error exists because non-null assertions are forbidden, apparently.
			throw Error('Ruffle could not get the latest Ruffle source. Since we\'re loading from unpkg this is genuinely impossible and you must\'ve done something incredibly cursed.');
		}
		return ruffleAPI;
	})();
	player.value = ruffle.createPlayer();
	player.value.style.width = '100%';
	player.value.style.height = '100%';
}

/**
 * @throws If `player.value` is uninitialized.
 */
function loadContent() {
	if (player.value === undefined) throw Error('Player is uninitialized.');
	ruffleContainer.value?.appendChild(player.value);
	loadingStatus.value = 'Loading Flash file';
	player.value.load(url.value).then(() => {
		loadingStatus.value = undefined;
	}).catch((error) => {
		console.error(error);
	});
}

function playPause() {
	if (playerHide.value) {
		dismissWarning();
		return;
	}
	if (player.value === undefined) return; // Not done loading or something
	if (player.value.isPlaying) {
		player.value.pause();
	} else {
		player.value.play();
	}
}

function fullscreen() {
	if (player.value === undefined) return; // Can't fullscreen an element that doesn't exist.
	if (player.value.isFullscreen) {
		player.value.exitFullscreen();
	} else {
		player.value.enterFullscreen();
	}
}

function stop() {
	if (player.value === undefined) return; // FIXME: This doesn't stop the loading process. (Though, should this even be implemented?)
	try {
		ruffleContainer.value?.removeChild(player.value);
	} catch {
		// This is fine
	}
	playerHide.value = true;
}

function toggleVisible() {
	hide.value = !hide.value;
	playerHide.value = true;
}

onDeactivated(() => {
	stop();
});

</script>

<style lang="scss" scoped>

.hide {
	border-radius: var(--radius-sm) !important;
	background-color: black !important;
	color: var(--accentLighten) !important;
	font-size: 12px !important;
}

.height-hack {
	/* HACK: I'm too stupid to do this better apparently. Copy-pasted from MkMediaList.vue */
	/* height: 100% doesn't work */
	/* FIXME: This breaks with more than one attachment, and the controls start overlapping the note buttons (like, boost, reply, etc) */
	height: clamp(
		64px,
		50cqh,
		min(360px, 50vh)
	);
}

.flash-player-enabled {
	position: relative;
	overflow: hidden;
	display: flex;
	flex-direction: column;

	> i {
		display: block;
		position: absolute;
		border-radius: var(--radius-sm);
		background-color: var(--fg);
		color: var(--accentLighten);
		font-size: 14px;
		opacity: .5;
		padding: 3px 6px;
		text-align: center;
		cursor: pointer;
		top: 12px;
		right: 12px;
		z-index: 4;
	}

	> .alt {
		display: block;
		position: absolute;
		border-radius: var(--radius-sm);
		background-color: black;
		color: var(--accentLighten);
		font-size: 0.8em;
		font-weight: bold;
		opacity: .5;
		padding: 2px 5px;
		cursor: help;
		user-select: none;
		top: 12px;
		left: 12px;
		z-index: 4;
	}

	> .flash-display {
		width: 100%;
		height: 100%;
		overflow-x: scroll;
		overflow-y: hidden;
		background-color: black;
		text-align: center;

		scrollbar-width: none;

		&::-webkit-scrollbar {
			display: none;
		}

		.player-hide {
			display: flex;
			flex-direction: column;
			justify-content: center;
			align-items: center;
			background: rgba(64, 64, 64, 0.3);
			backdrop-filter: var(--modalBgFilter);
			color: #fff;
			font-size: 12px;

			position: absolute;
			z-index: 4;
			width: 100%;
			height: 100%;

			> span {
				display: block;
			}
		}

		> .container {
			height: 100%;
		}
	}

	> .controls {
		display: flex;
		width: 100%;
		background-color: var(--bg);
		z-index: 5;

		> * {
			padding: 4px 8px;
		}

		> button, a {
			border: none;
			background-color: transparent;
			color: var(--accent);
			cursor: pointer;

			&:hover {
				background-color: var(--fg);
			}
		}

		> .fullscreen {
			margin-left: auto;
		}

		> input[type=range] {
			height: 21px;
			-webkit-appearance: none;
			width: 90px;
			padding: 0;
			margin: 4px 8px;
			overflow-x: hidden;

			&:disabled {
				filter: grayscale(100%);
			}

			&:focus {
				outline: none;

				&::-webkit-slider-runnable-track {
					background: var(--bg);
				}

				&::-ms-fill-lower, &::-ms-fill-upper {
					background: var(--bg);
				}
			}

			&::-webkit-slider-runnable-track {
				width: 100%;
				height: 100%;
				cursor: pointer;
				border-radius: 0;
				animate: 0.2s;
				background: var(--bg);
				border: 1px solid var(--fg);
				overflow-x: hidden;
			}

			&::-webkit-slider-thumb {
				border: none;
				height: 100%;
				width: 14px;
				border-radius: 0;
				background: var(--accentLighten);
				cursor: pointer;
				-webkit-appearance: none;
				box-shadow: calc(-100vw - 14px) 0 0 100vw var(--accent);
				clip-path: polygon(1px 0, 100% 0, 100% 100%, 1px 100%, 1px calc(50% + 10.5px), -100vw calc(50% + 10.5px), -100vw calc(50% - 10.5px), 0 calc(50% - 10.5px));
				z-index: 1;
			}

			&::-moz-range-track {
				width: 100%;
				height: 100%;
				cursor: pointer;
				border-radius: 0;
				animate: 0.2s;
				background: var(--bg);
				border: 1px solid var(--fg);
			}

			&::-moz-range-progress {
				cursor: pointer;
				height: 100%;
				background: var(--accent);
			}

			&::-moz-range-thumb {
				border: none;
				height: 100%;
				border-radius: 0;
				width: 14px;
				background: var(--accentLighten);
				cursor: pointer;
			}

			&::-ms-track {
				width: 100%;
				height: 100%;
				cursor: pointer;
				border-radius: 0;
				animate: 0.2s;
				background: transparent;
				border-color: transparent;
				color: transparent;
			}

			&::-ms-fill-lower {
				background: var(--accent);
				border: 1px solid var(--fg);
				border-radius: 0;
			}

			&::-ms-fill-upper {
				background: var(--bg);
				border: 1px solid var(--fg);
				border-radius: 0;
			}

			&::-ms-thumb {
				margin-top: 1px;
				border: none;
				height: 100%;
				width: 14px;
				border-radius: 0;
				background: var(--accentLighten);
				cursor: pointer;
			}
		}
	}
}

.flash-player-disabled {
	display: flex;
	justify-content: center;
	align-items: center;
	background: #111;
	color: #fff;

	> div {
		display: table-cell;
		text-align: center;
		font-size: 12px;

		> b {
			display: block;
		}
	}
}
</style>
