export const playbackSpeeds = [0.00001, 0.0001, 0.001, 0.01, 0.1, 0.5, 1, 2, 10] as const

export function stepPlaybackSpeed(current: number, direction: -1 | 1): number {
  return (direction === 1 ? playbackSpeeds.find(speed => speed > current) : playbackSpeeds.findLast(speed => speed < current)) ?? current
}
