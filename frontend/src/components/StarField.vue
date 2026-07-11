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

// 创建星点纹理（高质量）
const createStarTexture = (color: string, size: number): THREE.CanvasTexture => {
  const canvas = document.createElement('canvas');
  const textureSize = 64; // 提高纹理分辨率
  canvas.width = textureSize;
  canvas.height = textureSize;

  const ctx = canvas.getContext('2d')!;
  const center = textureSize / 2;

  // 创建更清晰的径向渐变
  const gradient = ctx.createRadialGradient(center, center, 0, center, center, center * 0.8);
  gradient.addColorStop(0, color);
  gradient.addColorStop(0.2, color);
  gradient.addColorStop(0.5, color + 'dd');
  gradient.addColorStop(0.8, color + '66');
  gradient.addColorStop(1, 'transparent');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, textureSize, textureSize);

  // 添加中心亮点
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.beginPath();
  ctx.arc(center, center, 2, 0, Math.PI * 2);
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
};

// 初始化场景
const initScene = () => {
  if (!containerRef.value) return;

  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000510); // 更深的太空色
  scene.fog = new THREE.Fog(0x000510, 50, 200); // 调整雾效范围适应新坐标

  // Camera - 调整位置适应新的坐标范围 [-12.64, 17.85] x [-13.58, 18.08] x [-8.89, 20.46]
  const width = containerRef.value.clientWidth;
  const height = containerRef.value.clientHeight;
  camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 500);
  // 从更远的位置观察，让整个星云可见
  camera.position.set(0, 0, 80);
  camera.lookAt(2.5, 2.25, 5.8); // 指向数据中心点

  // Renderer - 高质量渲染
  renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    precision: 'highp'
  });
  renderer.setSize(width, height);
  renderer.setPixelRatio(window.devicePixelRatio); // 使用完整像素比

  containerRef.value.appendChild(renderer.domElement);

  // Controls
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.minDistance = 20;  // 最近距离
  controls.maxDistance = 150; // 最远距离（调整适应新坐标）
  controls.target.set(2.5, 2.25, 5.8); // 围绕数据中心旋转

  // Raycaster
  raycaster = new THREE.Raycaster();
  raycaster.params.Sprite = { threshold: 3 };
  mouse = new THREE.Vector2();

  // 不需要灯光，星点自发光
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

    const texture = createStarTexture(color, star.size);
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      opacity: Math.min(star.brightness * 1.2, 1.0), // 提高亮度
      blending: THREE.AdditiveBlending,
      depthTest: true,
      depthWrite: false
    });

    const sprite = new THREE.Sprite(material);
    sprite.position.set(star.x, star.y, star.z);
    // 放大星点尺寸，让它们更明显
    const scale = star.size * 2.5;
    sprite.scale.set(scale, scale, 1);

    // 保存星点数据到 userData
    sprite.userData = star;

    scene.add(sprite);
    starSprites.push(sprite);
  });

  console.log(`渲染 ${starSprites.length} 个星点`);

  // 调整相机看向星点中心（新坐标范围的中心点）
  if (starSprites.length > 0) {
    controls.target.set(2.5, 2.25, 5.8);
    controls.update();
  }
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

// 处理鼠标移动
const handleMouseMove = (event: MouseEvent) => {
  if (!containerRef.value) return;

  const rect = containerRef.value.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

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
