import { computed, ref, watch } from 'vue';
import { loadFontStyle } from './load-font.js';
import type { Ref, ComputedRef } from 'vue';
import { miLocalStorage } from '@/local-storage.js';
import { i18n } from '@/i18n.js';

const fontList = [
	{ id: 'sharkey-default', name: 'Sharkey Default' },
	{ id: 'maokentangyuan', name: '猫啃糖圆' },
	{ id: 'chillroundgothic', name: '寒蝉圆黑' },
	{ id: 'lxgw-wenkai', name: '霞鹜文楷' },
	{ id: 'lxgw-marker-gothic', name: '霞鹜漫黑' },
	{ id: 'clearsans', name: '思源屏显臻宋' },
	{ id: 'genryomin2', name: '源流明體' },
	{ id: 'genwanmin2', name: '源雲明體' },
	{ id: 'jinghualaosong', name: '京華老宋體' },
	{ id: 'fusion-pixel', name: '缝合像素体' },
	{ id: 'misskey-biz', name: 'BIZ UDGothic' },
	{ id: 'roboto', name: 'Roboto' },
	{ id: 'arial', name: 'Arial' },
	{ id: 'times', name: 'Times' },
	{ id: 'yishanbeizhuan', name: '峄山碑篆体' },
	{ id: 'chongxiseal', name: '崇羲篆體' },
	{ id: 'system-ui', name: i18n.ts.useSystemFont },
	{ id: 'custom', name: i18n.ts._stpvPlus.customFont.label },
];

function getFontOptionsList(val: string): { id: string, name: string, default?: boolean }[] {
	switch (val) {
		case 'fusion-pixel':
			return [
				{ name: '8px', id: '8' },
				{ name: '10px', id: '10' },
				{ name: '12px', id: '12', default: true },
			];
		case 'chillroundgothic':
			return [
				{ name: 'Extra Light', id: 'EL' },
				{ name: 'Light', id: 'L' },
				{ name: 'Normal', id: 'N', default: true },
				{ name: 'Regular', id: 'R' },
				{ name: 'Middle', id: 'M' },
				{ name: 'Bold', id: 'B' },
			];
		default:
			return [];
	}
}

function getFontId(name: string, option: string) {
	if (getFontOptionsList(name).length === 0) {
		return `${name}`;
	} else {
		return `${name}_${option}`;
	}
}

export function getDefaultFontSettings() {
	const def_arr = miLocalStorage.getItem('defaultFontFace')?.split('_');
	const fontFace = ref(def_arr?.[0] ?? 'maokentangyuan');
	const fontFaceType = ref(def_arr?.[1] ?? '');
	const availableTypes = computed(() => getFontOptionsList(fontFace.value));

	async function setDefaultFont() {
		for (const klass of [...document.documentElement.classList.values()]) {
			if (klass.startsWith('default-font-')) {
				document.documentElement.classList.remove(klass);
			}
		}
		const newFontId = getFontId(fontFace.value, fontFaceType.value);
		miLocalStorage.setItem('defaultFontFace', newFontId);
		document.documentElement.classList.add(`default-font-${newFontId}`);

		await loadFontStyle(fontFace.value);
	}

	watch(fontFace, (newVal) => {
		const optionsList = getFontOptionsList(newVal);
		if (optionsList.length !== 0) {
			fontFaceType.value = optionsList.find((v) => v.default)?.id ?? '';
		} else {
			setDefaultFont();
		}
	});
	watch(fontFaceType, () => {
		setDefaultFont();
	});

	return ref({
		fontList,
		fontFace,
		fontFaceType,
		availableTypes,
		update: () => setDefaultFont(),
	}) as Ref<{
		fontList: {
			id: string;
			name: string;
		}[];
		fontFace: string;
		fontFaceType: string;
		availableTypes: {
			id: string;
			name: string;
			default?: boolean;
		}[];
		update: () => void,
	}>;
}
