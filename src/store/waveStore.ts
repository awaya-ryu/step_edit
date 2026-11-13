import { defineStore } from 'pinia'

export type Step = { start: number; end: number; time: number }
export type Knot = { x: number; y: number }

function stepsEqual(a: Step[], b: Step[]) {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
        const x = a[i], y = b[i]
        if (x.start !== y.start || x.end !== y.end || x.time !== y.time) return false
    }
    return true
}

export const useWaveStore = defineStore('wave', {
    state: () => ({
        steps: [
            { start: 50, end: 100, time: 1.0 },
            { start: 100, end: 80, time: 0.5 },
            { start: 80, end: 120, time: 1.2 }
        ] as Step[],
        currentMin: 0,
        currentMax: 300,
        minGap: 0.01, // 最小時間間隔
        lastSteps: null as Step[] | null // 1段だけのUndo
    }),
    getters: {
        knots(state): Knot[] {
            const out: Knot[] = []
            if (!state.steps.length) return out
            let t = 0
            out.push({ x: 0, y: state.steps[0].start })
            for (const s of state.steps) {
                t += s.time
                out.push({ x: t, y: s.end })
            }
            return out
        },
        canUndo(state): boolean {
            return !!state.lastSteps
        }
    },
    actions: {
        saveUndoSnapshot() {
            this.lastSteps = this.steps.map(s => ({ ...s }))
        },
        undoOnce() {
            if (!this.lastSteps) return
            const prev = this.lastSteps
            this.lastSteps = null
            this.steps = prev
        },
        setSteps(next: Step[], recordUndo = true) {
            if (recordUndo && !stepsEqual(this.steps, next)) {
                this.saveUndoSnapshot()
            }
            this.steps = next
        },
        applyKnots(knots: Knot[], recordUndo = true) {
            const res: Step[] = []
            for (let i = 0; i < knots.length - 1; i++) {
                const k0 = knots[i], k1 = knots[i + 1]
                res.push({
                    start: k0.y,
                    end: k1.y,
                    time: Math.max(0, +(k1.x - k0.x).toFixed(4))
                })
            }
            this.setSteps(res, recordUndo)
        },

        // 分割: 累積時間 x の位置で区間を2つに割る（線形補間で見た目不変）
        splitAtX(x: number, recordUndo = true) {
            // 区間探索（累積時間）
            let acc = 0
            let idx = -1
            for (let i = 0; i < this.steps.length; i++) {
                const s = this.steps[i]
                if (x >= acc && x <= acc + s.time) { idx = i; break }
                acc += s.time
            }
            if (idx < 0) return
            const s = this.steps[idx]
            const local = x - acc
            // minGapで時間両側をクランプ
            const t1 = Math.max(this.minGap, Math.min(s.time - this.minGap, +local.toFixed(4)))
            const t2 = +(s.time - t1).toFixed(4)
            if (t2 < this.minGap) return

            // 線形補間で mid を算出（見た目不変）
            const ratio = t1 / s.time
            const mid = +(s.start + (s.end - s.start) * ratio).toFixed(4)

            const left: Step = { start: s.start, end: mid, time: t1 }
            const right: Step = { start: mid, end: s.end, time: t2 }

            const next = this.steps.slice()
            next.splice(idx, 1, left, right)
            this.setSteps(next, recordUndo)
        },

        // 結合: step i と i+1 を連結（内部頂点を削除）
        mergeAtIndex(i: number, recordUndo = true) {
            if (i < 0 || i >= this.steps.length - 1) return
            const a = this.steps[i], b = this.steps[i + 1]
            const merged: Step = {
                start: a.start,
                end: b.end,
                time: +(a.time + b.time).toFixed(4)
            }
            const next = this.steps.slice()
            next.splice(i, 2, merged)
            this.setSteps(next, recordUndo)
        }
    }
})