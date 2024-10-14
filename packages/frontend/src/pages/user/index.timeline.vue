<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<notes-container :user="user"/>
</template>

<script lang="ts" setup>
import * as Misskey from 'misskey-js';
import NotesContainer from '@/pages/user/notes-container.vue';

defineProps<{
	user: Misskey.entities.UserDetailed;
}>();
</script>
