<template>
  <div class="metrics-trend">
    <canvas ref="canvasRef" :width="width" :height="height"></canvas>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, computed } from 'vue';

const props = defineProps<{
  history: Array<{
    step: number;
    currentMetrics: Record<string, number>;
    cumulativeMetrics: Record<string, number>;
  }>;
  maxSteps: number;
  metricKeys?: string[];
}>();

const canvasRef = ref<HTMLCanvasElement>();

const width = 420;
const height = 600;

let ctx: CanvasRenderingContext2D;
let animationId = 0;
let glowPhase = 0;

const metricColors = [
  { color: '#60A5FA', glowColor: 'rgba(96,165,250,' },
  { color: '#34D399', glowColor: 'rgba(52,211,153,' },
  { color: '#5EEAD4', glowColor: 'rgba(94,234,212,' },
  { color: '#A78BFA', glowColor: 'rgba(167,139,250,' },
  { color: '#38BDF8', glowColor: 'rgba(56,189,248,' },
  { color: '#7DD3FC', glowColor: 'rgba(125,211,252,' },
];

const metricLabel = (key: string) => {
  const labels: Record<string, string> = {
    ndcg_5: 'NDCG@5',
    ndcg_10: 'NDCG@10',
    ndcg_20: 'NDCG@20',
    ndcg_30: 'NDCG@30',
    hr_1: 'HR@1',
    hr_3: 'HR@3',
    hr_5: 'HR@5',
    hr_10: 'HR@10',
    recall_5: 'Recall@5',
    recall_10: 'Recall@10',
    precision_5: 'P@5',
    p_5: 'P@5',
    mrr_5: 'MRR@5',
    mrr_10: 'MRR@10',
    map: 'MAP',
  };
  return labels[key] ?? key.replace('_', '@').toUpperCase();
};

const metricDefs = computed(() => (props.metricKeys?.length ? props.metricKeys : [
  'ndcg_5',
  'hr_5',
  'mrr_5',
  'recall_5',
  'precision_5',
]).map((key, index) => ({
  key,
  label: metricLabel(key),
  ...(metricColors[index % metricColors.length]),
})));

const PADDING = { top: 50, right: 30, bottom: 50, left: 60 };
const chartWidth = width - PADDING.left - PADDING.right;
const chartHeight = height - PADDING.top - PADDING.bottom;

function drawBackground() {
  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, 'rgba(6, 12, 30, 0.85)');
  bg.addColorStop(0.5, 'rgba(8, 16, 40, 0.9)');
  bg.addColorStop(1, 'rgba(6, 12, 30, 0.85)');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = 'rgba(96, 165, 250, 0.15)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
}

function drawChartArea() {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.fillRect(PADDING.left, PADDING.top, chartWidth, chartHeight);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 10; i++) {
    const y = PADDING.top + (chartHeight / 10) * i;
    ctx.beginPath();
    ctx.moveTo(PADDING.left, y);
    ctx.lineTo(PADDING.left + chartWidth, y);
    ctx.stroke();
  }
  for (let i = 0; i <= 5; i++) {
    const x = PADDING.left + (chartWidth / 5) * i;
    ctx.beginPath();
    ctx.moveTo(x, PADDING.top);
    ctx.lineTo(x, PADDING.top + chartHeight);
    ctx.stroke();
  }
}

function drawAxes() {
  ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.font = '11px "JetBrains Mono", monospace';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';

  for (let i = 0; i <= 10; i++) {
    const val = 1 - i / 10;
    const y = PADDING.top + (chartHeight / 10) * i;
    ctx.fillText(val.toFixed(1), PADDING.left - 8, y);
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const xTicks = Math.min(props.maxSteps, 500);
  for (let i = 0; i <= 5; i++) {
    const step = Math.round((xTicks / 5) * i);
    const x = PADDING.left + (chartWidth / 5) * i;
    ctx.fillText(step.toString(), x, PADDING.top + chartHeight + 8);
  }

  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.font = 'bold 14px "JetBrains Mono", monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('EVAL METRICS TREND', PADDING.left, 14);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.font = '10px "JetBrains Mono", monospace';
  ctx.fillText('step ->', PADDING.left + chartWidth / 2 - 20, PADDING.top + chartHeight + 30);

  ctx.save();
  ctx.translate(14, PADDING.top + chartHeight / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('score ->', 0, 0);
  ctx.restore();
}

function drawLines() {
  const history = props.history;
  if (history.length < 2) return;

  const maxSteps = Math.max(props.maxSteps, 1);

  for (const def of metricDefs.value) {
    const points: { x: number; y: number }[] = [];
    for (const entry of history) {
      const val = entry.cumulativeMetrics[def.key] ?? 0;
      const x = PADDING.left + (entry.step / maxSteps) * chartWidth;
      const y = PADDING.top + (1 - val) * chartHeight;
      points.push({ x, y });
    }

    const gradient = ctx.createLinearGradient(PADDING.left, 0, PADDING.left + chartWidth, 0);
    gradient.addColorStop(0, `${def.glowColor}0.14)`);
    gradient.addColorStop(0.5, `${def.glowColor}0.52)`);
    gradient.addColorStop(1, `${def.glowColor}0.88)`);

    ctx.save();
    ctx.shadowBlur = 10;
    ctx.shadowColor = def.color;
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const cpx = (prev.x + curr.x) / 2;
      ctx.bezierCurveTo(cpx, prev.y, cpx, curr.y, curr.x, curr.y);
    }
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const cpx = (prev.x + curr.x) / 2;
      ctx.bezierCurveTo(cpx, prev.y, cpx, curr.y, curr.x, curr.y);
    }
    ctx.lineTo(points[points.length - 1].x, PADDING.top + chartHeight);
    ctx.lineTo(points[0].x, PADDING.top + chartHeight);
    ctx.closePath();
    const fillGrad = ctx.createLinearGradient(0, PADDING.top, 0, PADDING.top + chartHeight);
    fillGrad.addColorStop(0, `${def.glowColor}0.08)`);
    fillGrad.addColorStop(1, `${def.glowColor}0.01)`);
    ctx.fillStyle = fillGrad;
    ctx.fill();
    ctx.restore();
  }
}

function drawAutoTooltip() {
  const history = props.history;
  if (history.length < 2) return;

  const maxSteps = Math.max(props.maxSteps, 1);
  const entry = history[history.length - 1];
  if (!entry) return;

  const isComplete = entry.step >= maxSteps - 1;
  const x = PADDING.left + (entry.step / maxSteps) * chartWidth;
  const scanOpacity = isComplete ? 0.06 : 0.25;

  const scanGrad = ctx.createLinearGradient(x - 3, 0, x + 3, 0);
  scanGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
  scanGrad.addColorStop(0.5, `rgba(255, 255, 255, ${scanOpacity})`);
  scanGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = scanGrad;
  ctx.fillRect(x - 20, PADDING.top, 40, chartHeight);

  metricDefs.value.forEach((def, index) => {
    const val = entry.cumulativeMetrics[def.key] ?? 0;
    const y = PADDING.top + (1 - val) * chartHeight;

    ctx.save();
    ctx.shadowBlur = 12 + Math.sin(glowPhase + index) * 4;
    ctx.shadowColor = def.color;
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fillStyle = def.color;
    ctx.fill();
    ctx.restore();

    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
  });

  const tooltipX = x + 15 > width - 180 ? x - 165 : x + 15;
  const tooltipW = 155;
  const tooltipH = 30 + metricDefs.value.length * 20;
  const lastMetricKey = metricDefs.value[metricDefs.value.length - 1]?.key;
  const lastMetricY = PADDING.top + (1 - ((lastMetricKey ? (entry.cumulativeMetrics[lastMetricKey] ?? 0) : 0))) * chartHeight;
  const tooltipY = Math.max(PADDING.top, Math.min(lastMetricY - tooltipH / 2, PADDING.top + chartHeight - tooltipH));

  ctx.fillStyle = 'rgba(10, 18, 40, 0.92)';
  ctx.strokeStyle = 'rgba(96, 165, 250, 0.3)';
  ctx.lineWidth = 1;
  roundRect(ctx, tooltipX, tooltipY, tooltipW, tooltipH, 6);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.font = 'bold 11px "JetBrains Mono", monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(`Step ${entry.step + 1}`, tooltipX + 10, tooltipY + 8);

  ctx.font = '10px "JetBrains Mono", monospace';
  metricDefs.value.forEach((def, i) => {
    const val = entry.cumulativeMetrics[def.key] ?? 0;
    const yy = tooltipY + 26 + i * 18;
    ctx.beginPath();
    ctx.arc(tooltipX + 14, yy + 4, 3, 0, Math.PI * 2);
    ctx.fillStyle = def.color;
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.fillText(def.label, tooltipX + 22, yy);
    ctx.fillStyle = def.color;
    ctx.textAlign = 'right';
    ctx.fillText(val.toFixed(4), tooltipX + tooltipW - 10, yy);
    ctx.textAlign = 'left';
  });
}

function drawLegend() {
  const startX = PADDING.left + 10;
  const startY = height - 35;

  ctx.font = '10px "JetBrains Mono", monospace';
  const itemWidth = 75;
  metricDefs.value.forEach((def, i) => {
    const x = startX + i * itemWidth;
    ctx.beginPath();
    ctx.arc(x + 4, startY + 4, 3, 0, Math.PI * 2);
    ctx.fillStyle = def.color;
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(def.label, x + 12, startY + 4);
  });
}

function roundRect(canvasCtx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  canvasCtx.beginPath();
  canvasCtx.moveTo(x + r, y);
  canvasCtx.lineTo(x + w - r, y);
  canvasCtx.quadraticCurveTo(x + w, y, x + w, y + r);
  canvasCtx.lineTo(x + w, y + h - r);
  canvasCtx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  canvasCtx.lineTo(x + r, y + h);
  canvasCtx.quadraticCurveTo(x, y + h, x, y + h - r);
  canvasCtx.lineTo(x, y + r);
  canvasCtx.quadraticCurveTo(x, y, x + r, y);
  canvasCtx.closePath();
}

function render() {
  if (!ctx) return;
  ctx.clearRect(0, 0, width, height);

  const history = props.history;
  const isComplete = history.length > 0 && history[history.length - 1].step >= props.maxSteps - 1;

  drawBackground();
  drawChartArea();
  drawAxes();
  drawLines();
  drawAutoTooltip();
  drawLegend();

  if (!isComplete) {
    glowPhase += 0.03;
  }
  animationId = requestAnimationFrame(render);
}

onMounted(async () => {
  await nextTick();
  const canvas = canvasRef.value;
  if (!canvas) return;
  ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  render();
});

onUnmounted(() => {
  cancelAnimationFrame(animationId);
});
</script>

<style scoped>
.metrics-trend {
  position: absolute;
  left: 1.5rem;
  top: 50%;
  transform: translateY(-50%);
  width: 420px;
  height: 600px;
  z-index: 40;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 0 40px rgba(96, 165, 250, 0.08), inset 0 0 30px rgba(0, 0, 0, 0.3);
  pointer-events: none;
}

canvas {
  display: block;
}
</style>
