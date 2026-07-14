<template>
  <div class="metrics-trend" ref="containerRef">
    <canvas ref="canvasRef" :width="width" :height="height"></canvas>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue';

const props = defineProps<{
  history: Array<{
    step: number;
    currentMetrics: Record<string, number>;
    cumulativeMetrics: Record<string, number>;
  }>;
  maxSteps: number;
}>();

const containerRef = ref<HTMLDivElement>();
const canvasRef = ref<HTMLCanvasElement>();

const width = 420;
const height = 600;

let ctx: CanvasRenderingContext2D;
let animationId: number;
let glowPhase = 0;
let autoTooltipStep = 0;

// 指标配置（与 EvalReplay 对齐）
const metricDefs = [
  { key: 'ndcg_5', label: 'NDCG@5', color: '#60A5FA', glowColor: 'rgba(96,165,250,' },
  { key: 'hr_5', label: 'HR@5', color: '#34D399', glowColor: 'rgba(52,211,153,' },
  { key: 'mrr_5', label: 'MRR@5', color: '#F5A623', glowColor: 'rgba(245,166,35,' },
  { key: 'recall_5', label: 'Recall@5', color: '#A78BFA', glowColor: 'rgba(167,139,250,' },
  { key: 'precision_5', label: 'P@5', color: '#F472B6', glowColor: 'rgba(244,114,182,' },
];

const METRIC_COLORS = {
  ndcg_5: '#60A5FA',
  hr_5: '#34D399',
  mrr_5: '#F5A623',
  recall_5: '#A78BFA',
  precision_5: '#F472B6',
};

const PADDING = { top: 50, right: 30, bottom: 50, left: 60 };
const chartWidth = width - PADDING.left - PADDING.right;
const chartHeight = height - PADDING.top - PADDING.bottom;

function drawBackground() {
  // 深蓝色半透明背景
  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, 'rgba(6, 12, 30, 0.85)');
  bg.addColorStop(0.5, 'rgba(8, 16, 40, 0.9)');
  bg.addColorStop(1, 'rgba(6, 12, 30, 0.85)');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  // 微妙边框
  ctx.strokeStyle = 'rgba(96, 165, 250, 0.15)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
}

function drawChartArea() {
  // 图表区域背景
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.fillRect(PADDING.left, PADDING.top, chartWidth, chartHeight);

  // 网格线
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

  // Y 轴 (0-1)
  for (let i = 0; i <= 10; i++) {
    const val = 1 - i / 10;
    const y = PADDING.top + (chartHeight / 10) * i;
    ctx.fillText(val.toFixed(1), PADDING.left - 8, y);
  }

  // X 轴
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const xTicks = Math.min(props.maxSteps, 500);
  for (let i = 0; i <= 5; i++) {
    const step = Math.round((xTicks / 5) * i);
    const x = PADDING.left + (chartWidth / 5) * i;
    ctx.fillText(step.toString(), x, PADDING.top + chartHeight + 8);
  }

  // 标题
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.font = 'bold 14px "JetBrains Mono", monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('EVAL METRICS TREND', PADDING.left, 14);

  // 轴标签
  ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.font = '10px "JetBrains Mono", monospace';
  ctx.fillText('step →', PADDING.left + chartWidth / 2 - 20, PADDING.top + chartHeight + 30);

  ctx.save();
  ctx.translate(14, PADDING.top + chartHeight / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('score →', 0, 0);
  ctx.restore();
}

function drawLines() {
  const history = props.history;
  if (history.length < 2) return;

  const maxSteps = props.maxSteps;

  // 平滑绘制：三次贝塞尔
  for (const def of metricDefs) {
    const points: { x: number; y: number }[] = [];
    for (const entry of history) {
      const val = entry.cumulativeMetrics[def.key] ?? 0;
      const x = PADDING.left + (entry.step / maxSteps) * chartWidth;
      const y = PADDING.top + (1 - val) * chartHeight;
      points.push({ x, y });
    }

    // 线条渐变
    const gradient = ctx.createLinearGradient(PADDING.left, 0, PADDING.left + chartWidth, 0);
    gradient.addColorStop(0, def.glowColor + '0.15)');
    gradient.addColorStop(0.5, def.glowColor + '0.6)');
    gradient.addColorStop(1, def.glowColor + '0.9)');

    // 辉光层
    ctx.save();
    ctx.shadowBlur = 8;
    ctx.shadowColor = def.color;
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 2;
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

    // 填充区域
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
    fillGrad.addColorStop(0, def.glowColor + '0.08)');
    fillGrad.addColorStop(1, def.glowColor + '0.01)');
    ctx.fillStyle = fillGrad;
    ctx.fill();
  }
}

function drawAutoTooltip() {
  const history = props.history;
  if (history.length < 2) return;

  const maxSteps = props.maxSteps;
  const lastStep = history.length - 1;
  const isComplete = lastStep >= maxSteps - 1;

  // 评估进行中：流光紧跟最后一步
  let stepIndex: number;
  let isPaused = false;
  if (!isComplete) {
    stepIndex = lastStep;
  } else {
    // 评估完成后：自动循环播放，末尾停顿
    autoTooltipStep = (autoTooltipStep + 0.02) % (lastStep + 90);
    stepIndex = Math.min(Math.floor(autoTooltipStep), lastStep);
    isPaused = autoTooltipStep > lastStep;
  }

  const entry = history[stepIndex];
  if (!entry) return;

  const x = PADDING.left + (entry.step / maxSteps) * chartWidth;
  const y = PADDING.top + (1 - (entry.cumulativeMetrics['ndcg_5'] ?? 0)) * chartHeight;

  // 流光扫描线
  const scanGrad = ctx.createLinearGradient(x - 3, 0, x + 3, 0);
  scanGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
  scanGrad.addColorStop(0.5, `rgba(255, 255, 255, ${isPaused ? 0.05 : 0.25})`);
  scanGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = scanGrad;
  ctx.fillRect(x - 20, PADDING.top, 40, chartHeight);

  // 各指标点
  for (const def of metricDefs) {
    const val = entry.cumulativeMetrics[def.key] ?? 0;
    const y = PADDING.top + (1 - val) * chartHeight;

    // 外发光
    ctx.save();
    ctx.shadowBlur = 12 + Math.sin(glowPhase + metricDefs.indexOf(def)) * 4;
    ctx.shadowColor = def.color;
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fillStyle = def.color;
    ctx.fill();
    ctx.restore();

    // 内白点
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
  }

  // Tooltip 卡片
  if (!isPaused) {
    const tooltipX = x + 15 > width - 180 ? x - 165 : x + 15;
    const tooltipW = 155;
    const tooltipH = 30 + metricDefs.length * 20;
    const lastMetricY = PADDING.top + (1 - (entry.cumulativeMetrics[metricDefs[metricDefs.length - 1].key] ?? 0)) * chartHeight;
    const tooltipY = Math.max(PADDING.top, Math.min(lastMetricY - tooltipH / 2, PADDING.top + chartHeight - tooltipH));

    // 卡片背景
    ctx.fillStyle = 'rgba(10, 18, 40, 0.92)';
    ctx.strokeStyle = 'rgba(96, 165, 250, 0.3)';
    ctx.lineWidth = 1;
    roundRect(ctx, tooltipX, tooltipY, tooltipW, tooltipH, 6);
    ctx.fill();
    ctx.stroke();

    // Step 标题
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.font = 'bold 11px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`Step ${entry.step + 1}`, tooltipX + 10, tooltipY + 8);

    // 指标值
    ctx.font = '10px "JetBrains Mono", monospace';
    metricDefs.forEach((def, i) => {
      const val = entry.cumulativeMetrics[def.key] ?? 0;
      const yy = tooltipY + 26 + i * 18;
      // 颜色点
      ctx.beginPath();
      ctx.arc(tooltipX + 14, yy + 4, 3, 0, Math.PI * 2);
      ctx.fillStyle = def.color;
      ctx.fill();
      // 文字
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.fillText(`${def.label}`, tooltipX + 22, yy);
      ctx.fillStyle = def.color;
      ctx.textAlign = 'right';
      ctx.fillText(val.toFixed(4), tooltipX + tooltipW - 10, yy);
      ctx.textAlign = 'left';
    });
  }
}

function drawLegend() {
  const startX = PADDING.left + 10;
  const startY = height - 35;

  ctx.font = '10px "JetBrains Mono", monospace';
  const itemWidth = 75;
  metricDefs.forEach((def, i) => {
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

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function render() {
  if (!ctx) return;
  ctx.clearRect(0, 0, width, height);

  drawBackground();
  drawChartArea();
  drawAxes();
  drawLines();
  drawAutoTooltip();
  drawLegend();

  glowPhase += 0.03;
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

watch(() => props.history, () => {
  // history 变化时无需额外操作，render 循环会自动重绘
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
