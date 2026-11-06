import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LatestQuery } from '../../src/engine/latest-query'

function deferred<Result>() {
  let resolve!: (value: Result) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<Result>((success, failure) => { resolve = success; reject = failure })
  return { promise, resolve, reject }
}

describe('latest statistics queries', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('debounces a continuous selection and computes its final range', async () => {
    const results: number[] = []
    const execute = vi.fn(async (value: number) => value)
    const query = new LatestQuery<number>(value => results.push(value), vi.fn())
    for (let index = 0; index < 40; index++) {
      query.schedule(() => execute(index))
      await vi.advanceTimersByTimeAsync(16)
    }
    expect(execute).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(150)
    expect(execute).toHaveBeenCalledExactlyOnceWith(39)
    expect(results).toEqual([39])
  })

  it('runs at most one query while replacing ready work with the latest selection', async () => {
    const first = deferred<number>()
    const last = deferred<number>()
    const results: number[] = []
    const errors = vi.fn()
    const execute = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => last.promise)
    const query = new LatestQuery<number>(value => results.push(value), errors)
    query.schedule(() => execute(0))
    await vi.advanceTimersByTimeAsync(150)
    for (let index = 1; index <= 20; index++) {
      query.schedule(() => execute(index))
      await vi.advanceTimersByTimeAsync(200)
    }
    expect(execute.mock.calls).toEqual([[0]])
    first.resolve(0)
    await vi.advanceTimersByTimeAsync(0)
    expect(execute.mock.calls).toEqual([[0], [20]])
    expect(results).toEqual([])
    last.resolve(20)
    await vi.advanceTimersByTimeAsync(0)
    expect(results).toEqual([20])
    expect(errors).not.toHaveBeenCalled()
  })

  it('keeps the trailing delay if earlier work completes before the user stops moving', async () => {
    const first = deferred<number>()
    const results: number[] = []
    const next = vi.fn(async () => 2)
    const query = new LatestQuery<number>(value => results.push(value), vi.fn())
    query.schedule(() => first.promise, 0)
    await vi.advanceTimersByTimeAsync(0)
    query.schedule(next, 180)
    await vi.advanceTimersByTimeAsync(60)
    first.resolve(1)
    await vi.advanceTimersByTimeAsync(119)
    expect(next).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(next).toHaveBeenCalledOnce()
    expect(results).toEqual([2])
  })

  it.each(['resolve', 'reject'] as const)('clears pending work and ignores an in-flight %s after cancellation', async outcome => {
    const first = deferred<number>()
    const success = vi.fn()
    const failure = vi.fn()
    const next = vi.fn(async () => 2)
    const query = new LatestQuery<number>(success, failure)
    query.schedule(() => first.promise, 0)
    await vi.advanceTimersByTimeAsync(0)
    query.schedule(next, 0)
    await vi.advanceTimersByTimeAsync(0)
    query.cancel()
    if (outcome === 'resolve') first.resolve(1)
    else first.reject(new Error('source closed'))
    await vi.runAllTimersAsync()
    expect(next).not.toHaveBeenCalled()
    expect(success).not.toHaveBeenCalled()
    expect(failure).not.toHaveBeenCalled()
  })

  it('handles the current error and permits a later request', async () => {
    const success = vi.fn()
    const failure = vi.fn()
    const error = new Error('statistics failed')
    const query = new LatestQuery<number>(success, failure)
    query.schedule(async () => { throw error })
    await vi.runAllTimersAsync()
    expect(failure).toHaveBeenCalledExactlyOnceWith(error)
    query.schedule(async () => 3)
    await vi.runAllTimersAsync()
    expect(success).toHaveBeenCalledExactlyOnceWith(3)
  })

  it('cancels a debounce before it sends any work', async () => {
    const execute = vi.fn(async () => 1)
    const query = new LatestQuery<number>(vi.fn(), vi.fn())
    query.schedule(execute)
    query.cancel()
    await vi.runAllTimersAsync()
    expect(execute).not.toHaveBeenCalled()
  })
})
