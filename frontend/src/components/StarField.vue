<template>
  <div class="star-field" ref="containerRef"></div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
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
    starDataMap: Map<string, {
      sprite: THREE.Sprite;
      data: StarPoint;
      originalMaterial: THREE.SpriteMaterial;
      originalScale: THREE.Vector3;
    }>;
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
let composer: EffectComposer;
let bloomPass: UnrealBloomPass;

// Texture cache
const textureCache = new Map<string, THREE.CanvasTexture>();

// chunk_id to star mapping (includes ALL stars, not just rendered ones)
const starDataMap = new Map<string, {
  sprite: THREE.Sprite;
  data: StarPoint;
  originalMaterial: THREE.SpriteMaterial;
  originalScale: THREE.Vector3;
}>();

// Create star texture with caching
const createStarTexture = (color: string): THREE.CanvasTexture => {
  if (textureCache.has(color)) {
    return textureCache.get(color)!;
  }

  const canvas = document.createElement('canvas');
  const textureSize = 64;
  canvas.width = textureSize;
  canvas.height = textureSize;

  const ctx = canvas.getContext('2d')!;
  const center = textureSize / 2;

  const gradient = ctx.createRadialGradient(center, center, 0, center, center, center);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.03, 'rgba(255, 255, 255, 0.95)');
  gradient.addColorStop(0.08, color);
  gradient.addColorStop(0.35, color + '88');
  gradient.addColorStop(1, 'transparent');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, textureSize, textureSize);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;

  textureCache.set(color, texture);
  return texture;
};

// Init scene
const initScene = () => {
  if (!containerRef.value) return;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020408); // demo 的深邃太空背景
  scene.fog = new THREE.Fog(0x020408, 300, 800);

  const width = containerRef.value.clientWidth;
  const height = containerRef.value.clientHeight;
  camera = new THREE.PerspectiveCamera(25, width / height, 0.1, 2000);

  const centerX = 67.1;
  const centerY = 96.2;
  const centerZ = 30.9;
  camera.position.set(centerX, centerY + 50, centerZ + 300);
  camera.lookAt(centerX, centerY, centerZ);

  renderer = new THREE.WebGLRenderer({
    antialias: false,
    alpha: true,
    powerPreference: 'high-performance'
  });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));

  containerRef.value.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.45;
  controls.maxDistance = 800;
  controls.target.set(67.1, 96.2, 30.9);
  controls.enablePan = true;
  controls.panSpeed = 0.5;

  // Bloom 后处理
  composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  bloomPass = new UnrealBloomPass(
    new THREE.Vector2(width, height),
    0.15, // 泛光强度
    0.2,  // 光晕半径
    0.4   // 阈值：只有足够亮的星星才产生泛光
  );
  composer.addPass(bloomPass);

  raycaster = new THREE.Raycaster();
  raycaster.params.Sprite = { threshold: 2 };
  mouse = new THREE.Vector2();
};

// Render stars
const renderStars = () => {
  if (!props.stars.length || !props.config.domains) return;

  // Clear old sprites
  starSprites.forEach(sprite => scene.remove(sprite));
  starSprites = [];
  starDataMap.clear();

  // 螺旋臂参数（参考 demo 案例）
  const spiralFactor = 5;
  const centerPos = new THREE.Vector3(67.1, 96.2, 30.9);

  // Build mapping and render ALL stars
  props.stars.forEach((star) => {
    const domainConfig = props.config.domains[star.domain];
    const color = domainConfig?.color || '#ffffff';

    const texture = createStarTexture(color);
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      opacity: star.brightness,
      blending: THREE.AdditiveBlending,
      depthTest: true,
      depthWrite: false
    });

    const sprite = new THREE.Sprite(material);

    // 螺旋臂变换：从原位置计算相对中心的极坐标，应用旋臂偏移
    const dx = star.x - centerPos.x;
    const dz = star.z - centerPos.z;
    const radius = Math.sqrt(dx * dx + dz * dz);
    const theta = Math.atan2(dz, dx);

    // 旋臂角度偏移 + 随机噪声
    const armAngle = theta + (radius / 100) * spiralFactor + (Math.random() - 0.5) * 2;
    const finalRadius = radius * (1.0 + (Math.random() - 0.5) * 0.15);

    // Y 轴极扁平压制（中心稍厚，边缘压扁）
    const thickness = 0.6 - (radius / 200) * 0.5;
    const dy = star.y - centerPos.y;
    const compressedY = Math.sign(dy) * Math.max(Math.abs(dy) * 0.1, Math.abs(dy) * Math.max(0.05, thickness));

    sprite.position.set(
      centerPos.x + finalRadius * Math.cos(armAngle),
      centerPos.y + compressedY,
      centerPos.z + finalRadius * Math.sin(armAngle)
    );

    const scale = star.size * 0.06;
    sprite.scale.set(scale, scale, 1);

    // 保存真正的原始材质和 scale
    const originalMat = material.clone();
    const originalScale = new THREE.Vector3(scale, scale, 1);

    sprite.userData = {
      ...star,
      trueOriginals: {
        scale: originalScale.clone(),
        material: originalMat,
      },
    };

    scene.add(sprite);
    starSprites.push(sprite);

    starDataMap.set(star.chunk_id, { sprite, data: star, originalMaterial: originalMat, originalScale });
  });

  controls.update();

  emit('ready', {
    scene,
    camera,
    controls,
    starSprites,
    starDataMap
  });
};

// Animation loop
const animate = () => {
  animationId = requestAnimationFrame(animate);
  controls.update();
  composer.render(); // 用 Bloom 后处理渲染
};

// Handle resize
const handleResize = () => {
  if (!containerRef.value) return;
  const width = containerRef.value.clientWidth;
  const height = containerRef.value.clientHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  composer.setSize(width, height);
};

// Mouse move with throttle
let lastRaycastTime = 0;
const RAYCAST_THROTTLE = 100;

const handleMouseMove = (event: MouseEvent) => {
  if (!containerRef.value) return;
  const rect = containerRef.value.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  const now = Date.now();
  if (now - lastRaycastTime < RAYCAST_THROTTLE) return;
  lastRaycastTime = now;

  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(starSprites);

  if (intersects.length > 0) {
    emit('star-hover', intersects[0].object.userData as StarPoint);
    document.body.style.cursor = 'pointer';
  } else {
    emit('star-hover', null);
    document.body.style.cursor = 'default';
  }
};

// Handle click
const handleClick = (event: MouseEvent) => {
  if (!containerRef.value) return;
  const rect = containerRef.value.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(starSprites);

  if (intersects.length > 0) {
    emit('star-click', intersects[0].object.userData as StarPoint);
  }
};

// Lifecycle
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

  starSprites.forEach(sprite => {
    sprite.material.dispose();
    scene.remove(sprite);
  });

  textureCache.forEach(texture => texture.dispose());
  textureCache.clear();

  renderer.dispose();
  controls.dispose();
  if (composer) composer.dispose();
});

watch(() => props.stars, renderStars, { deep: true });
</script>

<style scoped>
.star-field {
  width: 100%;
  height: 100%;
  position: relative;
}
</style>
