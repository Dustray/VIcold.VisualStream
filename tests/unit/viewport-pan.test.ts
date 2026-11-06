import { describe, expect, it } from 'vitest'
import type { TimeRange } from '../../src/core/types'
import { duration } from '../../src/core/time'
import { ViewportPan } from '../../src/engine/viewport-pan'

function harness(origin = 0n) {
  let range = { start: origin + 200000n, end: origin + 400000n }
  let bounds = { start: origin, end: origin + 1000000n }
  let wall = 0
  let sequence = 0
  let active = false
  const samples: TimeRange[] = []
  const frames = new Map<number, (time: number) => void>()
  const motion = new ViewportPan(() => range, () => bounds, next => { range = next; samples.push(next) }, value => { active = value }, {
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
  function settle(): void {
    for (let count = 0; count < 120 && active; count++) tick()
    expect(active).toBe(false)
    expect(frames.size).toBe(0)
  }
  return { motion, tick, settle, samples, range: () => range, active: () => active, navigate: (next: TimeRange) => { motion.cancel(); range = next }, resize: (next: TimeRange) => { bounds = next } }
}

describe('smooth viewport panning', () => {
  it.each([0n, 1700000000000000000n])('animates a 20 percent step and preserves exact time at origin %s', origin => {
    const view = harness(origin)
    const initial = view.range()
    view.motion.pan(40000n)
    expect(view.range()).toEqual(initial)
    expect(view.active()).toBe(true)
    view.tick()
    expect(view.range().start).toBeGreaterThan(initial.start)
    expect(view.range().start).toBeLessThan(initial.start + 40000n)
    view.settle()
    expect(view.range()).toEqual({ start: initial.start + 40000n, end: initial.end + 40000n })
    expect(view.samples.length).toBeGreaterThan(5)
    expect(view.samples.every(sample => duration(sample) === duration(initial))).toBe(true)
    expect(view.samples.every((sample, index) => !index || sample.start >= view.samples[index - 1]!.start)).toBe(true)
  })

  it('accumulates repeated keys and reverses smoothly without losing the final displacement', () => {
    const view = harness()
    view.motion.pan(40000n)
    view.tick()
    view.motion.pan(40000n)
    view.motion.pan(40000n)
    view.settle()
    expect(view.range().start).toBe(320000n)
    view.motion.pan(-40000n)
    view.tick()
    expect(view.range().start).toBeLessThan(320000n)
    expect(view.range().start).toBeGreaterThan(280000n)
    view.settle()
    expect(view.range().start).toBe(280000n)
    view.motion.pan(40000n)
    view.motion.pan(-40000n)
    view.settle()
    expect(view.range().start).toBe(280000n)
  })

  it('clamps to the trace, moves away from either edge, and handles changed bounds', () => {
    const view = harness()
    view.motion.pan(-10000000n)
    view.settle()
    expect(view.range()).toEqual({ start: 0n, end: 200000n })
    view.motion.pan(10000000n)
    view.settle()
    expect(view.range()).toEqual({ start: 800000n, end: 1000000n })
    view.motion.pan(-40000n)
    view.settle()
    expect(view.range().start).toBe(760000n)
    view.motion.pan(40000n)
    view.resize({ start: 0n, end: 900000n })
    view.settle()
    expect(view.range()).toEqual({ start: 700000n, end: 900000n })
  })

  it('stops pending frames when direct navigation takes over and handles tiny ranges', () => {
    const view = harness()
    view.motion.pan(40000n)
    view.tick()
    const direct = { start: 100n, end: 200n }
    view.navigate(direct)
    view.tick()
    expect(view.range()).toEqual(direct)
    view.motion.pan(20n)
    view.settle()
    expect(view.range()).toEqual({ start: 120n, end: 220n })
    view.motion.pan(0n)
    expect(view.active()).toBe(false)
  })
})
