import type { TimeRange } from '../core/types'

export class IntervalIndex<Event extends TimeRange> {
  private readonly events: Event[]
  private readonly maximumEnds: bigint[]

  constructor(events: Event[]) {
    this.events = [...events].sort((left, right) => left.start < right.start ? -1 : left.start > right.start ? 1 : 0)
    let maximum = -(1n << 63n)
    this.maximumEnds = this.events.map(event => { if (event.end > maximum) maximum = event.end; return maximum })
  }

  at(time: bigint): Event[] {
    let lower = 0
    let upper = this.events.length
    while (lower < upper) {
      const middle = (lower + upper) >>> 1
      if (this.events[middle]!.start <= time) lower = middle + 1
      else upper = middle
    }
    const active: Event[] = []
    for (let index = lower - 1; index >= 0 && this.maximumEnds[index]! > time; index--) {
      const event = this.events[index]!
      if (event.end > time) active.push(event)
    }
    return active
  }

  boundaries(): bigint[] {
    return [...new Set(this.events.flatMap(event => [event.start, event.end]))].sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
  }
}
