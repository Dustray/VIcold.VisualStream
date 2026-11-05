import { describe, expect, it } from 'vitest'
import { eventColor } from '../../src/core/time'

describe('operator colors', () => {
  it.each([
    ['TASK_RMS_NORM_0', 'TASK_RMS_NORM_128'],
    ['TASK_GEMM_12_3', 'TASK_GEMM_8_147'],
    ['TASK_COPY 10', 'TASK_COPY'],
    ['TASK_ATTENTION(12, 27)', 'TASK_ATTENTION(5, 3)'],
    ['TASK_GEMM_0x000ab', 'TASK_GEMM_0x013ab'],
  ])('ignores instance numbers in %s and %s', (first, second) => {
    expect(eventColor(first)).toBe(eventColor(second))
  })

  it('keeps operator types distinct and handles unnamed events', () => {
    const colors = new Set(['TASK_RMS_NORM_1', 'TASK_GEMM_1', 'TASK_COPY_1', 'TASK_ATTENTION_1'].map(eventColor))
    expect(colors.size).toBeGreaterThan(1)
    expect(eventColor('')).toMatch(/^#[\da-f]{6}$/)
  })
})
