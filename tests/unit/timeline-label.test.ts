import { describe, expect, it } from 'vitest'
import { fitTimelineLabel } from '../../src/engine/timeline-label'

describe('timeline task labels', () => {
  const measure = (text: string) => text.length * 5
  it('shows early truncated labels without overflowing or altering the original name', () => {
    const name = 'RMS_NORM_123'
    expect(fitTimelineLabel(name, 60, measure)).toBe(name)
    expect(fitTimelineLabel(name, 30, measure)).toBe('RMS...')
    expect(fitTimelineLabel(name, 20, measure)).toBe('R...')
    expect(fitTimelineLabel(name, 15, measure)).toBe('...')
    expect(fitTimelineLabel(name, 14, measure)).toBe('')
    expect(fitTimelineLabel(name, 0, measure)).toBe('')
    expect(name).toBe('RMS_NORM_123')
  })
})
