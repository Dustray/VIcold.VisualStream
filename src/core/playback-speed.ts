export const defaultPlaybackSpeed = 0.0001
export const playbackSpeeds = [0.00001, 0.00005, 0.0001, 0.0005, 0.001, 0.01, 0.1, 0.5, 1] as const

export function stepPlaybackSpeed(current: number, direction: -1 | 1): number {
  return (direction === 1 ? playbackSpeeds.find(speed => speed > current) : playbackSpeeds.findLast(speed => speed < current)) ?? current
}
