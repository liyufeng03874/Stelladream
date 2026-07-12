<template>
  <div class="debug-panel" v-if="finalStar">
    <div class="panel-header">
      <span class="title">🔬 最终星样式记录</span>
      <button class="close-btn" @click="$emit('close')">✕</button>
    </div>

    <div class="star-info">
      <span class="chunk-id">{{ finalStar.data.chunk_id }}</span>
      <span class="domain-badge" :style="{ background: finalStar.domainColor + '44', color: finalStar.domainColor }">{{ finalStar.data.domain }}</span>
    </div>

    <!-- 已应用的样式（来自逻辑记录） -->
    <div class="section-label">📋 已应用样式（动画管线记录）</div>
    <div class="style-list">
      <div class="style-item" v-for="item in recordedStyles" :key="item.label">
        <span class="style-label">{{ item.label }}</span>
        <span class="style-value" :style="item.style">{{ item.value }}</span>
      </div>
    </div>

    <!-- 当前实际值（从 THREE 读取） -->
    <div class="section-label" style="margin-top: 16px;">🔍 当前实际值（实时读取）</div>
    <div class="style-list">
      <div class="style-item" v-for="item in currentValues" :key="item.label">
        <span class="style-label">{{ item.label }}</span>
        <span class="style-value" :style="item.style">{{ item.value }}</span>
      </div>
    </div>

    <!-- 操作按钮 -->
    <div class="actions">
      <button class="btn btn-refresh" @click="refreshCurrent">🔄 刷新当前值</button>
      <button class="btn btn-apply" @click="applyRecorded">⭐ 重新应用记录</button>
      <button class="btn btn-reset" @click="resetToOriginal">↩ 恢复原始</button>
    </div>

    <!-- 日志 -->
    <div class="log-section" v-if="logs.length">
      <div class="log-header">
        <span>操作日志</span>
        <button class="clear-log" @click="logs = []">清除</button>
      </div>
      <div class="log-content">
        <div v-for="(entry, i) in logs" :key="i" class="log-entry">
          <span class="log-time">{{ entry.time }}</span>
          <span class="log-text">{{ entry.text }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick } from 'vue';
import * as THREE from 'three';
import { gsap } from 'gsap';
import type { FinalStarInfo } from '../composables/useSearchAnimation';

const props = defineProps<{
  finalStar: FinalStarInfo;
}>();

const emit = defineEmits<{ close: []; reset: [] }>();

const logs = ref<{ time: string; text: string }[]>([]);

function addLog(text: string) {
  const now = new Date();
  const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
  logs.value.push({ time, text });
}

function getSprite() { return props.finalStar.sprite; }
function getMat(): THREE.SpriteMaterial { return getSprite().material as THREE.SpriteMaterial; }

// 查找光晕 —— 光晕在 scene 层级，不在 sprite.parent 下
function findGlows(): THREE.Sprite[] {
  const sprite = getSprite();
  // 找到 scene（通过向上遍历）
  let node: THREE.Object3D | null = sprite;
  while (node.parent) node = node.parent;
  const sceneNode = node;

  return sceneNode.children.filter(c => {
    if (c === sprite) return false;
    if (!(c instanceof THREE.Sprite)) return false;
    // 光晕通常比星星大很多 (size 30)
    const maxDim = Math.max(c.scale.x, c.scale.y);
    return maxDim > 10;
  }) as THREE.Sprite[];
}

// 已应用的样式（来自逻辑记录）
const recordedStyles = computed(() => {
  const style = props.finalStar.appliedStyle;
  return [
    { label: '核心颜色', value: style.coreColor.toUpperCase(), style: { color: style.coreColor } },
    { label: '目标透明度', value: style.opacity.toFixed(2) },
    { label: '混合模式', value: style.blending === THREE.AdditiveBlending ? 'Additive' : 'Normal' },
    { label: '放大倍率', value: `${style.scaleMultiplier}x` },
    { label: '光晕颜色', value: style.glowColor ? `0x${style.glowColor.toString(16).toUpperCase()}` : '无' },
    { label: '光晕大小', value: style.glowSize ? `${style.glowSize}` : '无' },
    { label: '呼吸动画', value: style.breathingActive ? '✅ 运行中' : '❌ 未启用' },
  ];
});

// 当前实际值
const currentValues = ref<{ label: string; value: string; style?: any }[]>([]);

function refreshCurrent() {
  const sprite = getSprite();
  const mat = getMat();
  const { trueOriginalScale } = props.finalStar;

  // 光晕在 scene 层级，找场景中所有光晕
  const glows = findGlows();
  const breathingTweens = gsap.getTweensOf(mat).filter((t: any) => t.vars?.yoyo);

  currentValues.value = [
    { label: '实际核心颜色', value: '#' + mat.color.getHexString(), style: { color: '#' + mat.color.getHexString() } },
    { label: '实际透明度', value: mat.opacity.toFixed(2) },
    { label: '实际混合', value: mat.blending === THREE.AdditiveBlending ? 'Additive' : mat.blending === THREE.NormalBlending ? 'Normal' : String(mat.blending) },
    { label: '实际 Scale', value: sprite.scale.x.toFixed(2) },
    { label: '放大倍率', value: (sprite.scale.x / trueOriginalScale.x).toFixed(1) + 'x' },
    { label: '光晕数量', value: glows.length > 0 ? `${glows.length}个 (${glows.map(g => '#' + (g.material as THREE.SpriteMaterial).color.getHexString()).join(', ')})` : '无' },
    { label: '呼吸 Tween', value: breathingTweens.length > 0 ? `✅ 存在 (${breathingTweens.length}个)` : '❌ 不存在' },
  ];

  addLog('🔄 刷新当前值完成');
}

// 重新应用记录的样式
function applyRecorded() {
  const sprite = getSprite();
  const mat = getMat();
  const { trueOriginalScale, appliedStyle } = props.finalStar;

  addLog('⭐ 重新应用记录的样式');

  gsap.killTweensOf(sprite.scale);
  gsap.killTweensOf(mat);

  mat.color.set(appliedStyle.coreColor);
  mat.opacity = 1;
  mat.blending = appliedStyle.blending;
  mat.needsUpdate = true;

  sprite.scale.set(
    trueOriginalScale.x * appliedStyle.scaleMultiplier,
    trueOriginalScale.y * appliedStyle.scaleMultiplier,
    trueOriginalScale.z * appliedStyle.scaleMultiplier,
  );

  // 清除旧光晕，创建新光晕
  findGlows().forEach(g => {
    sprite.parent?.remove(g);
    (g.material as THREE.Material).dispose();
  });

  if (appliedStyle.glowColor && appliedStyle.glowSize) {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    const hex = new THREE.Color(appliedStyle.glowColor);
    gradient.addColorStop(0, `rgba(${Math.round(hex.r * 255)},${Math.round(hex.g * 255)},${Math.round(hex.b * 255)},0.8)`);
    gradient.addColorStop(0.4, `rgba(${Math.round(hex.r * 255)},${Math.round(hex.g * 255)},${Math.round(hex.b * 255)},0.3)`);
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);

    const texture = new THREE.CanvasTexture(canvas);
    const glowMat = new THREE.SpriteMaterial({ map: texture, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const glow = new THREE.Sprite(glowMat);
    glow.position.copy(sprite.position);
    glow.scale.set(appliedStyle.glowSize, appliedStyle.glowSize, 1);
    sprite.parent?.add(glow);
  }

  if (appliedStyle.breathingActive) {
    gsap.to(mat, { opacity: appliedStyle.opacity, duration: 0.75, ease: 'sine.inOut', yoyo: true, repeat: -1 });
  }

  nextTick(() => refreshCurrent());
}

// 恢复原始
function resetToOriginal() {
  addLog('↩ 恢复原始样式');
  emit('reset');
}

// 初始加载
refreshCurrent();
addLog('面板已打开');
</script>

<style scoped>
.debug-panel {
  position: fixed;
  right: 16px;
  top: 50%;
  transform: translateY(-50%);
  background: rgba(8, 12, 30, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 14px;
  padding: 18px;
  min-width: 360px;
  max-width: 420px;
  backdrop-filter: blur(12px);
  z-index: 1000;
  color: #e0e0e0;
  font-size: 13px;
  font-family: 'Inter', -apple-system, sans-serif;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.panel-header .title {
  font-weight: 700;
  font-size: 15px;
  letter-spacing: 0.5px;
}

.close-btn {
  background: none;
  border: none;
  color: #666;
  font-size: 18px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
  transition: all 0.15s;
}

.close-btn:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.1);
}

.star-info {
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
  align-items: center;
}

.chunk-id {
  background: rgba(255, 255, 255, 0.08);
  padding: 3px 8px;
  border-radius: 4px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  color: #aaa;
}

.domain-badge {
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
}

.section-label {
  font-size: 12px;
  color: #888;
  font-weight: 600;
  margin-bottom: 8px;
  letter-spacing: 0.5px;
}

.style-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.style-item {
  display: flex;
  justify-content: space-between;
  padding: 6px 10px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.03);
  font-size: 12px;
}

.style-label {
  color: #999;
  font-weight: 500;
}

.style-value {
  font-family: 'JetBrains Mono', monospace;
  color: #60a5fa;
  font-weight: 600;
}

.actions {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 6px;
  margin-top: 14px;
}

.btn {
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  background: rgba(255, 255, 255, 0.05);
  color: #ddd;
}

.btn:hover {
  background: rgba(255, 255, 255, 0.1);
}

.btn-apply {
  background: rgba(52, 211, 153, 0.15);
  border-color: rgba(52, 211, 153, 0.3);
  color: #34d399;
}

.btn-reset {
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.2);
  color: #ef4444;
}

.btn-refresh {
  background: rgba(96, 165, 250, 0.15);
  border-color: rgba(96, 165, 250, 0.3);
  color: #60a5fa;
}

.log-section {
  margin-top: 14px;
  padding-top: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.log-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
  font-size: 12px;
  color: #888;
}

.clear-log {
  background: none;
  border: none;
  color: #555;
  font-size: 11px;
  cursor: pointer;
}

.clear-log:hover {
  color: #aaa;
}

.log-content {
  max-height: 100px;
  overflow-y: auto;
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
}

.log-entry {
  display: flex;
  gap: 8px;
  padding: 2px 0;
  color: #777;
}

.log-time {
  color: #555;
  min-width: 56px;
}
</style>
