<template>
  <div class="wave-editor">
    <div class="toolbar">
      <button :class="{active: splitMode}" @click="toggleSplitMode">
        分割
      </button>
      <button :disabled="!canMerge" @click="mergeSelected">
        結合
      </button>
      <button :disabled="!store.canUndo" @click="store.undoOnce">
        元に戻す
      </button>
      <span class="hint">タッチ: 頂点はドラッグ、分割は分割モードONで辺をタップ</span>
    </div>

    <canvas ref="chartEl" class="chart"></canvas>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useWaveStore } from '@/store/waveStore'

// Chart.js + drag plugin
import {
  Chart, LineController, LineElement, PointElement, LinearScale, TimeSeriesScale, Tooltip, Filler, Legend
} from 'chart.js'
import dragdata from 'chartjs-plugin-dragdata'
Chart.register(LineController, LineElement, PointElement, LinearScale, TimeSeriesScale, Tooltip, Filler, Legend, dragdata)

const store = useWaveStore()

// knotsは派生（getterをそのまま参照）
const chartData = computed(() => ({
  datasets: [
    {
      label: 'Target',
      data: store.knots.map(k => ({ x: k.x, y: k.y })),
      parsing: false,
      borderColor: '#4e79a7',
      backgroundColor: 'rgba(78,121,167,0.08)',
      fill: true,
      pointRadius: 6,
      pointHoverRadius: 8,
      pointHitRadius: 16,
      tension: 0
    }
  ]
}))

const chartEl = ref<HTMLCanvasElement | null>(null)
let chart: Chart<'line'> | null = null

// UI状態
const splitMode = ref(false)
const selectedKnotIndex = ref<number | null>(null)
const canMerge = computed(() => {
  if (selectedKnotIndex.value == null) return false
  // 内部頂点のみ結合可（最初と最後は不可）
  const i = selectedKnotIndex.value
  return i > 0 && i < store.knots.length - 1
})

// 分割モードのトグル
function toggleSplitMode() {
  splitMode.value = !splitMode.value
  // 分割モード時は選択解除（混乱防止）
  if (splitMode.value) selectedKnotIndex.value = null
}

// クリック/タップで頂点選択（Chart.jsのヒットテスト）
function selectVertexAtEvent(evt: unknown) {
  if (!chart) return
  const elements = chart.getElementsAtEventForMode(
    evt as any, 'nearest', { intersect: true }, false
  )
  if (!elements || !elements.length) {
    selectedKnotIndex.value = null
    return
  }
  const el = elements[0]
  // datasetIndexは0想定
  selectedKnotIndex.value = el.index
}

function mergeSelected() {
  if (selectedKnotIndex.value == null) return
  // knotsの内部頂点index -> stepsのステップindexに換算
  // knots: 0..N, steps: 0..N-1。内部頂点k（1..N-1）は stepsの (k-1, k) を結合
  const kIndex = selectedKnotIndex.value
  if (kIndex <= 0 || kIndex >= store.knots.length - 1) return
  const stepIndex = kIndex - 1
  store.mergeAtIndex(stepIndex)
  selectedKnotIndex.value = null
}

// onDragで制約（Yは共通範囲、Xは隣接＋minGap）
function onDragHandler(_e: any, datasetIndex: number, index: number, value: any) {
  const ds = chart?.data.datasets[datasetIndex] as any
  const pts = ds.data as { x: number; y: number }[]
  const prev = pts[index - 1]
  const next = pts[index + 1]

  // Yクランプ
  value.y = Math.max(store.currentMin, Math.min(store.currentMax, value.y))
  // Xクランプ（隣接＋minGap）
  const minX = prev ? prev.x + store.minGap : pts[index].x
  const maxX = next ? next.x - store.minGap : pts[index].x
  value.x = Math.max(minX, Math.min(maxX, value.x))
}

// onDragEndで knots -> steps を反映（1回だけUndo保存）
function onDragEndHandler(_e: any, datasetIndex: number) {
  const ds = chart?.data.datasets[datasetIndex] as any
  const knots = (ds.data as { x: number; y: number }[]).map(p => ({ x: +p.x, y: +p.y }))
  store.applyKnots(knots)
}

// 分割: 分割モードONで、辺タップ（頂点以外）時に実行
function handleSplitTap(evt: MouseEvent | TouchEvent) {
  if (!chart || !splitMode.value) return
  // 頂点に当たっていたら分割しない（ドラッグや選択と競合させない）
  const hitPoint = chart.getElementsAtEventForMode(evt as any, 'nearest', { intersect: true }, false)
  if (hitPoint && hitPoint.length) return

  // 直下のデータxを取得
  const pos = (evt as any).native || evt
  const canvas = chart!.canvas
  const rect = canvas.getBoundingClientRect()
  const clientX = (pos.touches && pos.touches[0]?.clientX) || (pos.changedTouches && pos.changedTouches[0]?.clientX) || (pos.clientX)
  if (clientX == null) return
  const xPx = clientX - rect.left
  const scaleX = (chart as any).scales.x
  if (!scaleX) return
  const xVal = scaleX.getValueForPixel(xPx) // 累積時間の値

  // 分割実行（store側でminGapと線形補間を適用）
  store.splitAtX(xVal)
}

// Chart初期化
const chartOptions: any = {
  responsive: true,
  animation: false,
  parsing: false,
  scales: {
    x: { type: 'linear', title: { display: true, text: 'Time [s]' }, ticks: { precision: 2 } },
    y: { type: 'linear', min: store.currentMin, max: store.currentMax, title: { display: true, text: 'Current [A]' } }
  },
  plugins: {
    legend: { display: false },
    tooltip: { enabled: true },
    dragData: {
      round: 2,
      showTooltip: true,
      dragX: true,
      dragY: true,
      onDrag: onDragHandler,
      onDragEnd: onDragEndHandler
    }
  },
  // 頂点選択（タップ/クリック）
  onClick: (evt: unknown) => {
    if (splitMode.value) {
      // 分割モード中のタップは分割に使う（頂点ヒット時はselectVertexAtEventで解除される）
      handleSplitTap(evt as any)
    } else {
      selectVertexAtEvent(evt)
    }
  }
}

onMounted(() => {
  if (!chartEl.value) return
  chart = new Chart(chartEl.value.getContext('2d')!, { type: 'line', data: chartData.value, options: chartOptions })

  // steps(=knots派生)が変わったらチャートを更新
  watch(
    () => store.knots,
    () => {
      if (!chart) return
      chart.data.datasets[0].data = chartData.value.datasets[0].data as any
      chart.update('none')
    },
    { deep: true }
  )

  // タップで分割（onClickでカバーできないケース用、明示的にリスナ追加）
  chart!.canvas.addEventListener('touchend', handleSplitTap, { passive: true })
})

onBeforeUnmount(() => {
  chart?.canvas.removeEventListener('touchend', handleSplitTap)
  chart?.destroy()
})
</script>

<style scoped>
.wave-editor { display: flex; flex-direction: column; gap: 8px; }
.toolbar { display: flex; align-items: center; gap: 8px; }
.toolbar button.active { background: #4e79a7; color: #fff; }
.chart { width: 100%; height: 360px; touch-action: none; }
.hint { color: #666; font-size: 12px; }
</style>