<script setup lang="ts">
import { Monitor, Moon, Palette, Sun } from 'lucide-vue-next'
import { resolvedTheme, setThemePreference, themePreference } from '../core/theme'
</script>

<template>
  <label class="theme-select" title="切换界面主题，自动记住选择">
    <Monitor v-if="themePreference === 'system'" :size="14" />
    <Palette v-else-if="resolvedTheme === 'classic'" :size="14" />
    <Sun v-else-if="resolvedTheme === 'light'" :size="14" />
    <Moon v-else :size="14" />
    <select :value="themePreference" aria-label="界面主题" @change="setThemePreference(($event.target as HTMLSelectElement).value)">
      <option value="classic">经典主题</option>
      <option value="light">明亮主题</option>
      <option value="dark">深暗主题</option>
      <option value="system">跟随系统</option>
    </select>
  </label>
</template>
