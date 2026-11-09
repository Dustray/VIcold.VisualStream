export type Nanoseconds = bigint
export type ComputeModelId = 'default' | 'megakernel'
export type SqlValue = bigint | number | string | Uint8Array | null
export type SqlRow = Record<string, SqlValue>

export interface TimeRange { start: Nanoseconds; end: Nanoseconds }
export interface RawTrack { id: number; parentId: number | null; name: string; subtitle?: string; maxDepth?: number; virtual?: boolean }
export interface RawSpan extends TimeRange {
  id: number
  trackId: number
  name: string
  depth: number
  argSetId: number
  incomplete: boolean
}
export interface EventPage { events: RawSpan[]; truncated: boolean }
export interface DensityBin extends TimeRange { trackId: number; count: number; name?: string; representativeDuration?: bigint; depth?: number; event?: TimeRange & { id: number } }
export interface ActivityBin extends TimeRange { busyDuration: bigint }
export interface RangeStatistics { count: number; sumDuration: bigint; unionDuration: bigint }
export interface TrackGroup { id: string; trackIds: number[] }
export interface GroupStatistics extends RangeStatistics { groupId: string }
export interface SourceMetadata extends TimeRange {
  id: string
  filename: string
  bytes: number
  fingerprint: string
  parserId: string
  parserVersion: string
  eventCount: number
  trackCount: number
  counterCount: number
  incompleteCount: number
  engineVersion: string
}
export interface EventQuery extends TimeRange { trackIds?: number[]; limit?: number }
export interface DensityQuery extends EventQuery { buckets: number; byDepth?: boolean }
export interface ParsedTraceSource {
  readonly metadata: SourceMetadata
  tracks(): Promise<RawTrack[]>
  events(query: EventQuery): Promise<EventPage>
  density(query: DensityQuery): Promise<DensityBin[]>
  statistics(query: EventQuery): Promise<RangeStatistics>
  groupedStatistics(range: TimeRange, groups: TrackGroup[]): Promise<GroupStatistics[]>
  activity(range: TimeRange, groups: TrackGroup[], buckets: number): Promise<ActivityBin[]>
  search(text: string, limit?: number): Promise<RawSpan[]>
  boundary(time: bigint, direction: -1 | 1): Promise<bigint | null>
  args(argSetId: number): Promise<Record<string, string>>
  close(): void
}
export interface ImportProgress { stage: string; fraction: number }
export interface TraceFileParser {
  readonly id: string
  probe(file: File): Promise<boolean>
  open(file: File, progress: (value: ImportProgress) => void): Promise<ParsedTraceSource>
}
export interface GroupResource { id: string; index: number; cuId: string; trackIds: number[] }
export interface CuResource { id: string; index: number; deviceId: string; groups: GroupResource[] }
export interface DeviceResource { id: string; label: string; rank: number | null; inferred: boolean; cus: CuResource[] }
export interface ReplayEvent extends RawSpan { sourceId: string; cuId?: string; groupId?: string; deviceId?: string }
export interface ReplayDensity extends DensityBin { sourceId: string; cuId?: string; groupId?: string }
export interface TimelineRow {
  id: string
  kind: 'source' | 'device' | 'group' | 'track'
  label: string
  subtitle: string
  sourceId: string
  cuId?: string
  groupId?: string
  treeDepth?: number
  hasChildren?: boolean
  collapsed?: boolean
  eventDepth?: number
  trackIds: number[]
}
export interface ReplayDataSource {
  readonly modelId: ComputeModelId
  readonly source: ParsedTraceSource
  readonly device: DeviceResource | null
  readonly diagnostics: string[]
  readonly trackMap: ReadonlyMap<number, { cuId: string; groupId: string }>
  offset: bigint
  readonly range: TimeRange
  events(query: EventQuery): Promise<{ events: ReplayEvent[]; truncated: boolean }>
  density(query: DensityQuery): Promise<ReplayDensity[]>
  statistics(query: EventQuery): Promise<RangeStatistics>
  cuStatistics(range: TimeRange): Promise<GroupStatistics[]>
  activity(range: TimeRange, buckets: number): Promise<ActivityBin[]>
  search(text: string, limit?: number): Promise<ReplayEvent[]>
  boundary(time: bigint, direction: -1 | 1): Promise<bigint | null>
}
export interface ComputeModelPlugin {
  readonly id: ComputeModelId
  build(source: ParsedTraceSource): Promise<ReplayDataSource>
}
export interface Bookmark { id: string; time: bigint; label: string }
export interface ProjectSnapshot {
  version: 1
  computeModel: { id: ComputeModelId; version: '1' }
  sources: { filename: string; fingerprint: string; parser: { id: 'perfetto'; version: '1' }; offset: string }[]
  visibleSources?: string[]
  time: string
  speed: number
  viewport: { start: string; end: string }
  selection: { start: string; end: string } | null
  loop: boolean
  bookmarks: { id: string; time: string; label: string }[]
}
