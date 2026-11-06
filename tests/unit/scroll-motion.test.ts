import { describe, expect, it } from 'vitest'
import { ScrollMotion } from '../../src/engine/scroll-motion'

function harness(quantized = false) {
  let position = 0
  let maximum = 1000
  let wall = 0
  let sequence = 0
  const frames = new Map<number, (time: number) => void>()
  const samples: number[] = []
  const motion = new ScrollMotion(() => position, () => maximum, next => { position = quantized ? Math.round(next) : next; samples.push(position) }, {
    now: () => wall,
    request: callback => { frames.set(++sequence, callback); return sequence },
    cancel: frame => { frames.delete(frame) },
  })
  function tick(elapsed = 16): void {
    wall += elapsed
    const pending = [...frames.values()]
    frames.clear()
    for (const callback of pending) callback(wall)
  }
  function settle(): void { for (let count = 0; count < 120 && frames.size; count++) tick(); expect(frames.size).toBe(0) }
  return { motion, samples, tick, settle, position: () => position, limit: (value: number) => { maximum = value } }
}

describe('smooth timeline scrolling', () => {
  it('interpolates wheel movement and accumulates bursts without losing distance', () => {
    const view = harness()
    view.motion.move(120)
    expect(view.position()).toBe(0)
    view.tick()
    expect(view.position()).toBeGreaterThan(0)
    expect(view.position()).toBeLessThan(120)
    view.motion.move(120)
    view.motion.move(120)
    view.settle()
    expect(view.position()).toBe(360)
    expect(view.samples.every((sample, index) => !index || sample >= view.samples[index - 1]!)).toBe(true)
  })

  it('uses elapsed time, clamps changing bounds and reverses from an edge', () => {
    const quick = harness()
    const slow = harness()
    quick.motion.move(100)
    slow.motion.move(100)
    quick.tick(8); quick.tick(8)
    slow.tick(16)
    expect(quick.position()).toBeCloseTo(slow.position(), 10)
    quick.motion.move(10000)
    quick.settle()
    expect(quick.position()).toBe(1000)
    quick.motion.move(-100)
    quick.settle()
    expect(quick.position()).toBe(900)
    quick.motion.move(100)
    quick.limit(500)
    quick.settle()
    expect(quick.position()).toBe(500)
  })

  it('cancels navigation cleanly and rejects nonfinite input', () => {
    const view = harness()
    view.motion.move(100)
    view.tick()
    const before = view.position()
    view.motion.cancel()
    view.tick()
    expect(view.position()).toBe(before)
    view.motion.move(Infinity)
    view.motion.move(Number.NaN)
    view.settle()
    expect(view.position()).toBe(before)
    view.motion.move(-1000)
    view.settle()
    expect(view.position()).toBe(0)
  })

  it('settles exactly when the browser rounds scrollTop to whole pixels', () => {
    const view = harness(true)
    view.motion.move(120)
    view.settle()
    expect(view.position()).toBe(120)
    view.motion.move(-119)
    view.settle()
    expect(view.position()).toBe(1)
  })
})
