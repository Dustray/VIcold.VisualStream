import { describe, expect, it } from 'vitest'
import { PlaybackClock } from '../../src/engine/playback-clock'
import { IntervalIndex } from '../../src/engine/interval-index'

describe('playback clock', () => {
  it('keeps time continuous when speed changes and resumes after buffering', () => {
    let wall = 0
    const clock = new PlaybackClock(() => wall)
    clock.configure({ start: 0n, end: 10_000_000_000n })
    clock.play()
    wall = 100
    clock.setSpeed(0.5)
    expect(clock.snapshot().time).toBe(100_000_000n)
    wall = 200
    clock.advance(wall)
    expect(clock.snapshot().time).toBe(150_000_000n)
    clock.setBuffering(true)
    wall = 2200
    clock.advance(wall)
    expect(clock.snapshot().time).toBe(150_000_000n)
    clock.setBuffering(false)
    wall = 2400
    clock.advance(wall)
    expect(clock.snapshot().time).toBe(250_000_000n)
    clock.pause()
    wall = 9000
    clock.advance(wall)
    expect(clock.snapshot().time).toBe(250_000_000n)
  })

  it('wraps across several loop lengths and stops at the trace end', () => {
    let wall = 0
    const clock = new PlaybackClock(() => wall)
    clock.configure({ start: 0n, end: 1_000_000_000n })
    clock.setLoop({ start: 100_000_000n, end: 200_000_000n })
    clock.seek(150_000_000n)
    clock.play()
    wall = 370
    clock.advance(wall)
    expect(clock.snapshot().time).toBe(120_000_000n)
    clock.setLoop(null)
    wall = 2000
    clock.advance(wall)
    expect(clock.snapshot()).toMatchObject({ time: 1_000_000_000n, playing: false })
    expect(() => clock.setSpeed(NaN)).toThrow()
    expect(() => clock.setSpeed(0)).toThrow()
  })
})

describe('interval index', () => {
  it('finds long intervals crossing many short events and uses half-open bounds', () => {
    const index = new IntervalIndex([{ start: 0n, end: 1000n, id: 'long' }, { start: 10n, end: 20n, id: 'short' }, { start: 20n, end: 30n, id: 'next' }])
    expect(index.at(20n).map(event => event.id)).toEqual(['next', 'long'])
    expect(index.at(900n).map(event => event.id)).toEqual(['long'])
    expect(index.at(1000n)).toEqual([])
    expect(index.boundaries()).toEqual([0n, 10n, 20n, 30n, 1000n])
  })
})
