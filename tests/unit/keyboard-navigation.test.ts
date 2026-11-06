import { describe, expect, it } from 'vitest'
import { KeyboardNavigation, type NavigationKey } from '../../src/engine/keyboard-navigation'

function harness() {
  let wall = 0
  let sequence = 0
  const steps: { key: NavigationKey; elapsed: number | null; wall: number }[] = []
  const frames = new Map<number, (time: number) => void>()
  const navigation = new KeyboardNavigation((key, elapsed) => steps.push({ key, elapsed, wall }), {
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
  return { navigation, steps, tick, frames }
}

describe('held keyboard navigation', () => {
  it.each(['w', 'a', 's', 'd'] as const)('keeps a short %s tap as exactly one step', key => {
    const view = harness()
    view.navigation.press(key)
    view.tick(40)
    view.navigation.release(key)
    view.tick(600)
    expect(view.steps).toEqual([{ key, elapsed: null, wall: 0 }])
    expect(view.navigation.active).toBe(false)
    expect(view.frames.size).toBe(0)
  })

  it('continues before the initial animation settles without any OS repeat events', () => {
    const view = harness()
    view.navigation.press('w')
    for (let count = 0; count < 40; count++) view.tick()
    const continuous = view.steps.filter(step => step.elapsed !== null)
    expect(continuous[0]!.wall).toBe(96)
    expect(continuous.length).toBe(35)
    expect(continuous.reduce((total, step) => total + step.elapsed!, 0)).toBe(560)
    expect(continuous.every((step, index) => !index || step.wall - continuous[index - 1]!.wall === 16)).toBe(true)
    view.navigation.release('w')
    const count = view.steps.length
    view.tick(500)
    expect(view.steps).toHaveLength(count)
  })

  it('ignores OS repeats instead of accelerating again or restarting cancelled keys', () => {
    const view = harness()
    view.navigation.press('d')
    view.tick(100)
    view.navigation.press('d', true)
    view.navigation.press('d')
    expect(view.steps.filter(step => step.elapsed === null)).toHaveLength(1)
    view.navigation.cancel()
    view.navigation.press('d', true)
    view.tick(500)
    expect(view.navigation.active).toBe(false)
    expect(view.frames.size).toBe(0)
    expect(view.steps).toHaveLength(2)
    view.navigation.press('a')
    expect(view.navigation.active).toBe(true)
    expect(view.steps.at(-1)).toMatchObject({ key: 'a', elapsed: null })
  })

  it('uses elapsed time to give 60 Hz and 120 Hz displays the same continuous distance', () => {
    const elapsed = (interval: number) => {
      const view = harness()
      view.navigation.press('a')
      for (let time = interval; time <= 480; time += interval) view.tick(interval)
      return view.steps.reduce((total, step) => total + (step.elapsed ?? 0), 0)
    }
    expect(elapsed(16)).toBe(400)
    expect(elapsed(8)).toBe(400)
  })

  it('resumes an earlier held key without an extra tap when the newer key is released', () => {
    const view = harness()
    view.navigation.press('w')
    view.tick(100)
    view.navigation.press('d')
    view.tick(100)
    view.navigation.release('d')
    view.tick()
    expect(view.steps.at(-1)).toMatchObject({ key: 'w', elapsed: 16 })
    expect(view.steps.filter(step => step.elapsed === null)).toHaveLength(2)
    view.navigation.release('w')
    expect(view.frames.size).toBe(0)
  })

  it('caps long frame gaps and cancels all held keys together', () => {
    const view = harness()
    view.navigation.press('a')
    view.tick(5000)
    expect(view.steps.at(-1)).toMatchObject({ key: 'a', elapsed: 50 })
    view.navigation.press('s')
    view.navigation.cancel()
    view.navigation.release('s')
    view.tick(500)
    expect(view.navigation.active).toBe(false)
    expect(view.frames.size).toBe(0)
    expect(view.steps).toHaveLength(3)
  })
})
