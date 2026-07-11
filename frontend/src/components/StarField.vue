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
  'ready': [context: {
    scene: THREE.Scene;
    camera: THREE.Camera;
    controls: any;
    starSprites: THREE.Sprite[];
    starDataMap: Map<string, { sprite: THREE.Sprite; data: StarPoint }>;
  }];
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

// chunk_id 到星点的映射
const starDataMap = new Map<string, { sprite: THREE.Sprite; data: StarPoint }>();

// 创建星点纹理（优化性能 + 缓存）
const createStarTexture = (color: string): THREE.CanvasTexture => {
  // 检查缓存
  if (textureCache.has(color)) {
    return textureCache.get(color)!;
  }

  const canvas = document.createElement('canvas');
  const textureSize = 64;
  canvas.width = textureSize;
  canvas.height = textureSize;

  const ctx = canvas.getContext('2d')!;
  const center = textureSize / 2;

  // 锐利的核心亮点 + 柔和的光晕
  const gradient = ctx.createRadialGradient(center, center, 0, center, center, center);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.03, 'rgba(255, 255, 255, 0.95)'); // 锐利核心
  gradient.addColorStop(0.08, color); // 颜色在稍外层
  gradient.addColorStop(0.35, color + '88');
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
  scene.background = new THREE.Color(0x000005);
  scene.fog = new THREE.Fog(0x000005, 300, 800); // 远处星星渐隐，营造深空感

  // Camera - 窄FOV + 远距离 = 望远镜效果
  const width = containerRef.value.clientWidth;
  const height = containerRef.value.clientHeight;
  camera = new THREE.PerspectiveCamera(25, width / height, 0.1, 2000); // 25°窄FOV，望远镜视角

  // 相机拉远到300，让星点在视野中收缩成遥远的亮点
  const scale = 15; // 坐标放大倍数
  const centerX = 0.92 * scale;
  const centerY = 1.03 * scale;
  const centerZ = 3.56 * scale;
  camera.position.set(centerX, centerY + 50, centerZ + 300);
  camera.lookAt(centerX, centerY, centerZ);

  // Renderer - 性能优化
  renderer = new THREE.WebGLRenderer({
    antialias: false, // 关闭抗锯齿提升性能
    alpha: true,
    powerPreference: 'high-performance'
  });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // 限制像素比

  containerRef.value.appendChild(renderer.domElement);

  // Controls - 远距离观测模式
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 100;  // 最近100，保持远距离
  controls.maxDistance = 800;  // 最远800
  controls.target.set(centerX, centerY, centerZ);
  controls.enablePan = true;
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

  // 只渲染前1000个星点以提升性能
  const starsToRender = props.stars.slice(0, 1000);

  // 坐标放大 + 缩放调整
  const SCALE = 15; // 放大坐标，拉开星点间距

  // 创建新的星点
  starsToRender.forEach((star) => {
    const domainConfig = props.config.domains[star.domain];
    const color = domainConfig?.color || '#ffffff';

    const texture = createStarTexture(color); // 使用缓存的纹理
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      opacity: star.brightness,
      blending: THREE.AdditiveBlending,
      depthTest: true,
      depthWrite: false
    });

    const sprite = new THREE.Sprite(material);
    // 放大坐标，拉开星点间距
    sprite.position.set(star.x * SCALE, star.y * SCALE, star.z * SCALE);
    // 缩小星点，让远距离下看起来像远处的星星
    const scale = star.size * 0.06;
    sprite.scale.set(scale, scale, 1);

    sprite.userData = star;

    scene.add(sprite);
    starSprites.push(sprite);

    // 添加到映射表
    starDataMap.set(star.chunk_id, { sprite, data: star });
  });

  console.log(`渲染 ${starSprites.length} / ${props.stars.length} 个星点 (${textureCache.size} 个纹理)`);

  controls.update();

  // 发送就绪事件
  emit('ready', {
    scene,
    camera,
    controls,
    starSprites,
    starDataMap
  });
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
