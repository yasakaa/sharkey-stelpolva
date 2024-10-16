import dns from 'dns';
import { readFile } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { defineConfig } from 'vite';
import type { PluginOption, UserConfig } from 'vite';
import * as yaml from 'js-yaml';
import locales from '../../locales/index.js';
import { getConfig } from './vite.config.js';

dns.setDefaultResultOrder('ipv4first');

const defaultConfig = getConfig();

const { port } = yaml.load(await readFile('../../.config/default.yml', 'utf-8'));

const httpUrl = `http://localhost:${port}/`;
const websocketUrl = `ws://localhost:${port}/`;
const embedUrl = `http://localhost:5174/`;

// activitypubリクエストはProxyを通し、それ以外はViteの開発サーバーを返す
function varyHandler(req: IncomingMessage) {
	if (req.headers.accept?.includes('application/activity+json')) {
		return null;
	}
	return '/index.html';
}

const externalPackages = [
	// sharkey: Used for SkFlashPlayer, has large wasm files so it's loaded via Ruffle's preferred CDN
	{
		name: 'ruffle',
		match: /^@ruffle-rs\/ruffle\/?(?<file>.*)$/,
		path(id: string, pattern: RegExp): string {
			const match = pattern.exec(id)?.groups;
			return match
				? `https://esm.sh/@ruffle-rs/ruffle@${packageInfo.dependencies['@ruffle-rs/ruffle']}/${match['file']}`
				: id;
		},
	},
]

const devConfig: UserConfig = {
	// 基本の設定は vite.config.js から引き継ぐ
	...defaultConfig,
	root: 'src',
	publicDir: '../assets',
	base: './',
	server: {
		host: 'localhost',
		port: 5173,
		proxy: {
			'/api': {
				changeOrigin: true,
				target: httpUrl,
			},
			'/assets': httpUrl,
			'/static-assets': httpUrl,
			'/client-assets': httpUrl,
			'/files': httpUrl,
			'/twemoji': httpUrl,
			'/fluent-emoji': httpUrl,
			'/tossface': httpUrl,
			'/sw.js': httpUrl,
			'/streaming': {
				target: websocketUrl,
				ws: true,
			},
			'/favicon.ico': httpUrl,
			'/robots.txt': httpUrl,
			'/embed.js': httpUrl,
			'/embed': {
				target: embedUrl,
				ws: true,
			},
			'/identicon': {
				target: httpUrl,
				rewrite(path) {
					return path.replace('@localhost:5173', '');
				},
			},
			'/url': httpUrl,
			'/proxy': httpUrl,
			'/_info_card_': httpUrl,
			'/bios': httpUrl,
			'/cli': httpUrl,
			'/inbox': httpUrl,
			'/emoji/': httpUrl,
			'/notes': {
				target: httpUrl,
				bypass: varyHandler,
			},
			'/users': {
				target: httpUrl,
				bypass: varyHandler,
			},
			'/.well-known': {
				target: httpUrl,
			},
		},
	},
	build: {
		...defaultConfig.build,
		rollupOptions: {
			...defaultConfig.build?.rollupOptions,
			external: externalPackages.map(p => p.match),
			output: {
				...defaultConfig.build?.rollupOptions?.output,
				paths(id) {
					for (const p of externalPackages) {
						if (p.match.test(id)) {
							return p.path(id, p.match);
						}
					}

					return id;
				},
			},
			input: 'index.html',
		},
	},

	define: {
		...defaultConfig.define,
		_LANGS_FULL_: JSON.stringify(Object.entries(locales)),
	},
};

export default defineConfig(({ command, mode }) => devConfig);

