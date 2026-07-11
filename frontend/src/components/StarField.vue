<template>
  <div class="star-field" ref="containerRef"></div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { StarPoint } from '../api';

interface Props {
  stars: StarPoint[];
  config: any;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  'star-click': [star: StarPoint];
  'star-hover': [star: StarPoint | null];
}>();

const containerRef = ref<HTMLDivElement>();

let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let renderer: THREE.WebGLRenderer;
let controls: OrbitControls;
let raycaster: THREE.Raycaster;
let mouse: THREE.Vector2;
let starSprites: THREE.Sprite[] = [];
let animationId: number;

// 纹理缓存 - 避免重复创建
const textureCache = new Map<string, THREE.CanvasTexture>();

// 创建星点纹理（优化性能 + 缓存）
const createStarTexture = (color: string): THREE.CanvasTexture => {
  // 检查缓存
  if (textureCache.has(color)) {
    return textureCache.get(color)!;
  }

  const canvas = document.createElement('canvas');
  const textureSize = 32;
  canvas.width = textureSize;
  canvas.height = textureSize;

  const ctx = canvas.getContext('2d')!;
  const center = textureSize / 2;

  // 简化的径向渐变
  const gradient = ctx.createRadialGradient(center, center, 0, center, center, center * 0.7);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.1, color);
  gradient.addColorStop(0.5, color + 'aa');
  gradient.addColorStop(1, 'transparent');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, textureSize, textureSize);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;

  // 缓存纹理
  textureCache.set(color, texture);
  return texture;
};

// 初始化场景
const initScene = () => {
  if (!containerRef.value) return;

  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000510);
  scene.fog = new THREE.Fog(0x000510, 80, 300); // 雾效更远，让远处星点渐隐

  // Camera - 相机在数据中心，环顾四周
  const width = containerRef.value.clientWidth;
  const height = containerRef.value.clientHeight;
  camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 500); // 更大的FOV
  // 相机位于星云中心
  camera.position.set(2.5, 2.25, 5.8);
  camera.lookAt(20, 10, 15); // 初始看向某个方向

  // Renderer - 性能优化
  renderer = new THREE.WebGLRenderer({
    antialias: false, // 关闭抗锯齿提升性能
    alpha: true,
    powerPreference: 'high-performance'
  });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // 限制像素比

  containerRef.value.appendChild(renderer.domElement);

  // Controls - 从中心环顾四周
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 1;  // 可以在星云中自由移动
  controls.maxDistance = 80; // 不要飞太远
  controls.target.set(20, 10, 15); // 初始目标点
  controls.enablePan = true; // 允许平移
  controls.panSpeed = 0.5;

  // Raycaster
  raycaster = new THREE.Raycaster();
  raycaster.params.Sprite = { threshold: 2 };
  mouse = new THREE.Vector2();
};

// 渲染星点
const renderStars = () => {
  if (!props.stars.length || !props.config.domains) return;

  // 清除旧的星点
  starSprites.forEach(sprite => scene.remove(sprite));
  starSprites = [];

  // 创建新的星点
  props.stars.forEach((star) => {
    const domainConfig = props.config.domains[star.domain];
    const color = domainConfig?.color || '#ffffff';

    const texture = createStarTexture(color); // 使用缓存的纹理
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      opacity: Math.min(star.brightness * 0.85, 0.9),
      blending: THREE.AdditiveBlending,
      depthTest: true,
      depthWrite: false
    });

    const sprite = new THREE.Sprite(material);
    sprite.position.set(star.x, star.y, star.z);
    const scale = star.size * 1.2; // 进一步减小
    sprite.scale.set(scale, scale, 1);

    sprite.userData = star;

    scene.add(sprite);
    starSprites.push(sprite);
  });

  console.log(`渲染 ${starSprites.length} 个星点 (${textureCache.size} 个纹理)`);

  controls.update();
};

// 动画循环
const animate = () => {
  animationId = requestAnimationFrame(animate);

  controls.update();
  renderer.render(scene, camera);
};

// 处理窗口大小变化
const handleResize = () => {
  if (!containerRef.value) return;

  const width = containerRef.value.clientWidth;
  const height = containerRef.value.clientHeight;

  camera.aspect = width / height;
  camera.updateProjectionMatrix();

  renderer.setSize(width, height);
};

// 处理鼠标移动 - 节流优化
let lastRaycastTime = 0;
const RAYCAST_THROTTLE = 100; // 每100ms最多一次射线检测

const handleMouseMove = (event: MouseEvent) => {
  if (!containerRef.value) return;

  const rect = containerRef.value.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  // 节流射线检测
  const now = Date.now();
  if (now - lastRaycastTime < RAYCAST_THROTTLE) return;
  lastRaycastTime = now;

  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(starSprites);

  if (intersects.length > 0) {
    const hoveredStar = intersects[0].object.userData as StarPoint;
    emit('star-hover', hoveredStar);
    document.body.style.cursor = 'pointer';
  } else {
    emit('star-hover', null);
    document.body.style.cursor = 'default';
  }
};

// 处理点击
const handleClick = (event: MouseEvent) => {
  if (!containerRef.value) return;

  const rect = containerRef.value.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(starSprites);

  if (intersects.length > 0) {
    const clickedStar = intersects[0].object.userData as StarPoint;
    emit('star-click', clickedStar);
  }
};

// 生命周期
onMounted(() => {
  initScene();
  renderStars();
  animate();

  window.addEventListener('resize', handleResize);
  containerRef.value?.addEventListener('mousemove', handleMouseMove);
  containerRef.value?.addEventListener('click', handleClick);
});

onUnmounted(() => {
  cancelAnimationFrame(animationId);
  window.removeEventListener('resize', handleResize);
  containerRef.value?.removeEventListener('mousemove', handleMouseMove);
  containerRef.value?.removeEventListener('click', handleClick);

  // 清理资源
  starSprites.forEach(sprite => {
    sprite.material.dispose();
    scene.remove(sprite);
  });

  // 清理纹理缓存
  textureCache.forEach(texture => texture.dispose());
  textureCache.clear();

  renderer.dispose();
  controls.dispose();
});

// 监听数据变化
watch(() => props.stars, renderStars, { deep: true });
</script>

<style scoped>
.star-field {
  width: 100%;
  height: 100%;
  position: relative;
}
</style>
