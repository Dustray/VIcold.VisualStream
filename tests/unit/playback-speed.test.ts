import { describe, expect, it } from 'vitest'
import { playbackSpeeds, stepPlaybackSpeed } from '../../src/core/playback-speed'

describe('playback speed shortcuts', () => {
  it('moves one preset at a time in either direction without wrapping', () => {
    let speed: number = playbackSpeeds[0]
    expect(stepPlaybackSpeed(speed, -1)).toBe(speed)
    for (const preset of playbackSpeeds.slice(1)) {
      speed = stepPlaybackSpeed(speed, 1)
      expect(speed).toBe(preset)
    }
    expect(stepPlaybackSpeed(speed, 1)).toBe(speed)
    for (const preset of playbackSpeeds.slice(0, -1).reverse()) {
      speed = stepPlaybackSpeed(speed, -1)
      expect(speed).toBe(preset)
    }
  })

  it.each([0.008563528, 0.07])('chooses neighboring presets from demo or custom rate %s', speed => {
    expect(stepPlaybackSpeed(speed, 1)).toBe(speed < 0.01 ? 0.01 : 0.1)
    expect(stepPlaybackSpeed(speed, -1)).toBe(speed < 0.01 ? 0.001 : 0.01)
  })

  it('keeps acceleration monotonic for custom rates beyond the preset range', () => {
    expect(stepPlaybackSpeed(0.000001, -1)).toBe(0.000001)
    expect(stepPlaybackSpeed(0.000001, 1)).toBe(0.00001)
    expect(stepPlaybackSpeed(100, 1)).toBe(100)
    expect(stepPlaybackSpeed(100, -1)).toBe(10)
  })
})
