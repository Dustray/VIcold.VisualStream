export function fitTimelineLabel(text: string, width: number, measure: (text: string) => number): string {
  if (width <= 0) return ''
  if (measure(text) <= width) return text
  const suffix = '...'
  if (measure(suffix) > width) return ''
  let start = 0
  let end = text.length
  while (start < end) {
    const middle = Math.ceil((start + end) / 2)
    if (measure(text.slice(0, middle) + suffix) <= width) start = middle
    else end = middle - 1
  }
  return text.slice(0, start) + suffix
}
