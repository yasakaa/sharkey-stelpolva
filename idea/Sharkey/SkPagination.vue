<!--
SPDX-FileCopyrightText: hazelnoot and other Sharkey contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<!--
	Important note: this is a generic component.
	Some operations require Vue helpers to satisfy typescript.
	See this page for more information: https://vuejs.org/api/sfc-script-setup.html#generics
-->

<template>
<MkPagination ref="mkPagination" :pagination="pagination" :disableAutoload="disableAutoLoad" :displayLimit="computedDisplayLimit">
	<template #empty>
		<slot name="empty">
			<div class="_fullinfo">
				<img :src="noContentImage ?? infoImageUrl" class="_ghost" :alt="noContentText" aria-hidden="true"/>
				<div>{{ noContentText }}</div>
			</div>
		</slot>
	</template>

	<template #default="{ items }">
		<slot :items="items as Response"></slot>
	</template>
</MkPagination>
</template>

<script lang="ts">
export type { Paging } from '@/components/MkPagination.vue';
</script>

<script setup lang="ts" generic="Endpoint extends keyof Endpoints">
import { computed, shallowRef } from 'vue';
import type { Endpoints } from 'misskey-js';
import type { SwitchCaseResponseType } from 'misskey-js/built/api.types.js';
import type { ComponentExposed } from 'vue-component-type-helpers';
import { infoImageUrl } from '@/instance.js';
import { i18n } from '@/i18n.js';
import MkPagination, { Paging } from '@/components/MkPagination.vue';
import { MisskeyEntity } from '@/types/date-separated-list.js';

type Response = SwitchCaseResponseType<Endpoint, Endpoints[Endpoint]['req']> & MisskeyEntity[];
type Entity = Response[number];

const mkPagination = shallowRef<InstanceType<typeof MkPagination>>();

const props = withDefaults(defineProps<{
	pagination: Paging<Endpoint>;
	disableAutoLoad?: boolean;
	displayLimit?: number | null;
	noContentText?: string;
	noContentImage?: string;
}>(), {
	disableAutoLoad: false,
	displayLimit: undefined,
	noContentText: i18n.ts.noNotes,
	noContentImage: undefined,
});

// Value of displayLimit with default value applied.
const computedDisplayLimit = computed(() => {
	// undefined (default) means to use the value from paging.
	if (props.displayLimit === undefined) {
		return props.pagination.limit;
	}

	// number means to use that value.
	// null means to use the default from MkPagination.
	return props.displayLimit ?? undefined;
});

/* eslint-disable @typescript-eslint/no-non-null-assertion */
defineExpose({
	// Expose all the same properties...
	...mkPagination.value!,

	// But override these to have a narrower type.
	items: mkPagination.value!.items as Map<string, Entity> | undefined,
	queue: mkPagination.value!.queue as Map<string, Entity> | undefined,
	prepend: (item: Entity) => mkPagination.value!.prepend(item),
	append: (item: Entity) => mkPagination.value!.append(item),
	updateItem: (id: Entity['id'], replacer: (old: Entity) => Entity) => {
		return mkPagination.value!.updateItem(id, old => replacer(old as Entity));
	},
});
/* eslint-enable @typescript-eslint/no-non-null-assertion */
</script>
