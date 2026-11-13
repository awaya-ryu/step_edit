import type { Step, Knot } from '@/store/waveStore'

export function stepsToKnots(steps: Step[]): Knot[] {
  const out: Knot[] = []
  if (!steps.length) return out
  let t = 0
  out.push({ x: 0, y: steps[0].start })
  for (const s of steps) {
    t += s.time
    out.push({ x: t, y: s.end })
  }
  return out
}

export function knotsToSteps(knots: Knot[]): Step[] {
  const res: Step[] = []
  for (let i = 0; i < knots.length - 1; i++) {
    const k0 = knots[i], k1 = knots[i + 1]
    res.push({
      start: k0.y,
      end: k1.y,
      time: Math.max(0, +(k1.x - k0.x).toFixed(4))
    })
  }
  return res
}