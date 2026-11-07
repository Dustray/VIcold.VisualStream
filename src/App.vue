<script setup lang="ts">
import { onBeforeUnmount } from 'vue'
import ReplayWorkspace from './ReplayWorkspace.vue'
import { useSessionsStore } from './stores/sessions'

const sessions = useSessionsStore()
onBeforeUnmount(() => sessions.dispose())
</script>

<template>
  <ReplayWorkspace v-if="sessions.activeSession" :key="sessions.activeId" :session="sessions.activeSession" />
</template>
