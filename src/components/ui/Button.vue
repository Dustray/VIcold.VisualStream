<script setup lang="ts">
import { Primitive } from 'reka-ui'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'

const variants = cva('ui-button', {
  variants: {
    variant: { default: 'ui-button-primary', secondary: 'ui-button-secondary', outline: 'ui-button-outline', ghost: 'ui-button-ghost' },
    size: { default: 'ui-button-md', sm: 'ui-button-sm', icon: 'ui-button-icon' },
  },
  defaultVariants: { variant: 'default', size: 'default' },
})
type ButtonVariants = VariantProps<typeof variants>
withDefaults(defineProps<{ variant?: ButtonVariants['variant']; size?: ButtonVariants['size']; as?: string; asChild?: boolean; class?: string }>(), { as: 'button' })
</script>

<template>
  <Primitive :as="as" :as-child="asChild" :class="cn(variants({ variant, size }), $props.class)" type="button"><slot /></Primitive>
</template>
