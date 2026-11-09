import { describe, expect, it } from 'vitest'
import type { TimeRange } from '../../src/core/types'
import { duration } from '../../src/core/time'
import { ViewportZoom } from '../../src/engine/viewport-zoom'

function harness(initial: TimeRange, bounds = initial) {
  let range = { ...initial }
  let wall = 0
  let sequence = 0
  let active = false
  const frames = new Map<number, (time: number) => void>()
  const samples: TimeRange[] = []
  const zoom = new ViewportZoom(() => range, () => bounds, next => { range = next; samples.push(next) }, next => { active = next }, {
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
  function settle(): void { for (let count = 0; count < 120 && active; count++) tick(); expect(active).toBe(false) }
  return { zoom, samples, tick, settle, range: () => range, active: () => active, navigate: (next: TimeRange) => { zoom.cancel(); range = next } }
}

describe('smooth viewport zoom', () => {
  it('exposes the final anchored range before animation so details can be fetched ahead', () => {
    const view = harness({ start: 0n, end: 1_000_000n })
    expect(view.zoom.destination).toBeNull()
    view.zoom.zoom(0.5, 0.8)
    expect(view.zoom.destination).toEqual({ start: 400_000n, end: 900_000n })
    view.zoom.zoom(0.5, 0.8)
    expect(view.zoom.destination).toEqual({ start: 600_000n, end: 850_000n })
    view.tick()
    expect(duration(view.range())).toBeGreaterThan(250_000n)
    expect(view.zoom.destination).toEqual({ start: 600_000n, end: 850_000n })
    view.zoom.cancel()
    expect(view.zoom.destination).toBeNull()
  })
  it('animates every frame around the pointer, including large absolute timestamps', () => {
    const origin = 1_700_000_000_000_000_000n
    const view = harness({ start: origin, end: origin + 1_000_000n })
    view.zoom.zoom(0.5, 0.8)
    expect(view.range()).toEqual({ start: origin, end: origin + 1_000_000n })
    view.tick()
    expect(duration(view.range())).toBeGreaterThan(500_000n)
    expect(duration(view.range())).toBeLessThan(1_000_000n)
    view.settle()
    expect(view.range()).toEqual({ start: origin + 400_000n, end: origin + 900_000n })
    for (const range of view.samples) expect(range.start + BigInt(Math.round(Number(duration(range)) * 0.8))).toBe(origin + 800_000n)
    expect(view.samples.length).toBeGreaterThan(5)
  })

  it('accumulates rapid wheel input and retargets to the new pointer without jumping', () => {
    const view = harness({ start: 0n, end: 1_000_000n })
    view.zoom.zoom(0.5, 0.8)
    view.zoom.zoom(0.5, 0.8)
    view.tick()
    const before = { ...view.range() }
    const anchor = before.start + BigInt(Math.round(Number(duration(before)) * 0.2))
    view.zoom.zoom(2, 0.2)
    expect(view.range()).toEqual(before)
    const first = view.samples.length
    view.settle()
    expect(duration(view.range())).toBe(500_000n)
    for (const range of view.samples.slice(first)) expect(range.start + BigInt(Math.round(Number(duration(range)) * 0.2))).toBe(anchor)
  })

  it('respects the trace and minimum range and reverses immediately from a zoom limit', () => {
    const view = harness({ start: 0n, end: 10_000n })
    view.zoom.zoom(0.00001, 1)
    view.settle()
    expect(view.range()).toEqual({ start: 9900n, end: 10_000n })
    view.zoom.zoom(0.5, 1)
    expect(view.active()).toBe(false)
    view.zoom.zoom(1000, 0)
    view.settle()
    expect(view.range()).toEqual({ start: 0n, end: 10_000n })
    const short = harness({ start: 0n, end: 50n })
    short.zoom.zoom(0.5)
    expect(short.active()).toBe(false)
    expect(short.range()).toEqual({ start: 0n, end: 50n })
  })

  it('stops pending frames when a drag, fit or other navigation takes over', () => {
    const view = harness({ start: 0n, end: 1_000_000n })
    view.zoom.zoom(0.5)
    view.tick()
    const destination = { start: 123_000n, end: 456_000n }
    view.navigate(destination)
    view.tick(1000)
    expect(view.range()).toEqual(destination)
    expect(view.active()).toBe(false)
    const samples = view.samples.length
    view.zoom.zoom(NaN)
    view.zoom.zoom(0)
    view.zoom.zoom(-1)
    view.tick()
    expect(view.samples).toHaveLength(samples)
  })

  it('keeps the same zoom progress across different display refresh rates', () => {
    const slow = harness({ start: 0n, end: 100_000_000n })
    const fast = harness({ start: 0n, end: 100_000_000n })
    slow.zoom.zoom(0.25, 0.7)
    fast.zoom.zoom(0.25, 0.7)
    for (let count = 0; count < 5; count++) slow.tick(32)
    for (let count = 0; count < 20; count++) fast.tick(8)
    expect(Math.abs(Number(duration(slow.range()) - duration(fast.range())))).toBeLessThan(10)
    slow.settle()
    fast.settle()
    expect(fast.range()).toEqual(slow.range())
  })
})
