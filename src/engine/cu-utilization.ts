import { duration } from '../core/time'
import type { DeviceResource, GroupStatistics, TimeRange } from '../core/types'

export interface CuUtilization {
  cuId: string
  deviceId: string
  index: number
  busyDuration: bigint
  idleDuration: bigint
  eventCount: number
  ratio: number | null
}

export interface UtilizationSummary {
  range: TimeRange
  items: CuUtilization[]
  busyDuration: bigint
  capacity: bigint
  ratio: number | null
  equivalentCus: number | null
}

export function summarizeCuUtilization(range: TimeRange, devices: DeviceResource[], statistics: GroupStatistics[]): UtilizationSummary {
  const span = duration(range) > 0n ? duration(range) : 0n
  const byCu = new Map(statistics.map(item => [item.groupId, item]))
  const items = devices.flatMap(device => device.cus.map(cu => {
    const item = byCu.get(cu.id)
    const busy = item?.unionDuration ?? 0n
    return { cuId: cu.id, deviceId: device.id, index: cu.index, busyDuration: busy, idleDuration: span - busy, eventCount: item?.count ?? 0, ratio: span > 0n ? Number(busy) / Number(span) : null }
  }))
  const busyDuration = items.reduce((total, item) => total + item.busyDuration, 0n)
  const capacity = span * BigInt(items.length)
  return { range: { ...range }, items, busyDuration, capacity, ratio: capacity > 0n ? Number(busyDuration) / Number(capacity) : null, equivalentCus: span > 0n && items.length ? Number(busyDuration) / Number(span) : null }
}
