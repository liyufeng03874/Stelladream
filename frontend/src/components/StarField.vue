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
import { gpuProfile } from '../utils/gpuDetect';

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
let composer: EffectComposer | undefined;
let bloomPass: UnrealBloomPass | undefined;

// 底层星尘（16000 个极微小粒子）
let starDust: THREE.Points | null = null;

// Texture cache
const textureCache = new Map<string, THREE.CanvasTexture>();

// chunk_id to star mapping
const starDataMap = new Map<string, {
  sprite: THREE.Sprite;
  data: StarPoint;
  originalMaterial: THREE.SpriteMaterial;
  originalScale: THREE.Vector3;
}>();

// 星星纹理：中心纯白够亮才能触发 Bloom
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
  // 中心纯白高亮 → 触发 Bloom 阈值 (0.4)
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.05, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.1, 'rgba(255, 255, 255, 0.9)');
  // 向外渐变色
  gradient.addColorStop(0.2, color);
  gradient.addColorStop(0.5, color + '44');
  gradient.addColorStop(1, 'transparent');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, textureSize, textureSize);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;

  textureCache.set(color, texture);
  return texture;
};

// 创建底层星尘（16000 个极微小暗色粒子）
const createStarDust = () => {
  if (!starDataMap.size) return;

  const count = gpuProfile.starDustCount;
  if (count === 0) return; // 无 GPU 时完全关闭星尘
  const positions = new Float32Array(count * 3);

  // 从所有星星的范围中采样
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  starDataMap.forEach(({ sprite }) => {
    minX = Math.min(minX, sprite.position.x);
    maxX = Math.max(maxX, sprite.position.x);
    minY = Math.min(minY, sprite.position.y);
    maxY = Math.max(maxY, sprite.position.y);
    minZ = Math.min(minZ, sprite.position.z);
    maxZ = Math.max(maxZ, sprite.position.z);
  });

  // 稍微扩大范围
  const rangeX = (maxX - minX) * 0.8;
  const rangeY = (maxY - minY) * 0.3;
  const rangeZ = (maxZ - minZ) * 0.8;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const centerZ = (minZ + maxZ) / 2;

  for (let i = 0; i < count; i++) {
    // 指数分布，让中心更密
    const radius = Math.pow(Math.random(), 1.2);
    const angle = Math.random() * Math.PI * 2;

    positions[i * 3] = centerX + Math.cos(angle) * radius * rangeX + (Math.random() - 0.5) * rangeX * 0.3;
    positions[i * 3 + 1] = centerY + (Math.random() - 0.5) * rangeY;
    positions[i * 3 + 2] = centerZ + Math.sin(angle) * radius * rangeZ + (Math.random() - 0.5) * rangeZ * 0.3;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color: 0x334466, // 暗蓝灰色
    size: 0.15, // 极微小
    transparent: true,
    opacity: 0.3,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  });

  starDust = new THREE.Points(geometry, material);
  scene.add(starDust);
};

// Init scene
const initScene = () => {
  if (!containerRef.value) return;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020408);

  const width = containerRef.value.clientWidth;
  const height = containerRef.value.clientHeight;
    // 根据数据范围动态设置相机位置，确保所有星星可见
    camera = new THREE.PerspectiveCamera(25, width / height, 0.1, 2000);

    let centerX = 0, centerY = 0, centerZ = 0, camZ = 100;
    if (props.stars.length > 0) {
      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;
      let minZ = Infinity, maxZ = -Infinity;
      for (const p of props.stars) {
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
        if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
      }
      centerX = (minX + maxX) / 2;
      centerY = (minY + maxY) / 2;
      centerZ = (minZ + maxZ) / 2;
      const spanX = maxX - minX;
      const spanY = maxY - minY;
      const spanZ = maxZ - minZ;
      const maxSpan = Math.max(spanX, spanY, spanZ);
      camZ = maxSpan * 1.3 + 20;
      console.log(`[StarField] data range x:[${minX.toFixed(0)},${maxX.toFixed(0)}] y:[${minY.toFixed(0)},${maxY.toFixed(0)}] z:[${minZ.toFixed(0)},${maxZ.toFixed(0)}]`);
      console.log(`[StarField] camera center=(${centerX.toFixed(1)},${centerY.toFixed(1)},${centerZ.toFixed(1)}) camZ=${camZ.toFixed(1)}`);
    }

    camera.position.set(centerX, centerY, camZ);
    camera.lookAt(centerX, centerY, centerZ);

  renderer = new THREE.WebGLRenderer({
    antialias: false,
    alpha: true,
    powerPreference: gpuProfile.level === 'none' ? 'default' : 'high-performance'
  });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, gpuProfile.maxPixelRatio));

  containerRef.value.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxDistance = 1200;
  controls.target.set(centerX, centerY, centerZ);
  controls.enablePan = true;
  controls.panSpeed = 0.5;

  // Bloom 后处理（GPU 降级策略）
  let useBloom = gpuProfile.bloom;
  if (useBloom) {
    composer = new EffectComposer(renderer);
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    bloomPass = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      gpuProfile.bloomStrength,  // 根据 GPU 等级调整强度
      0.2,
      0.4
    );
    composer.addPass(bloomPass);
  }

  raycaster = new THREE.Raycaster();
  raycaster.params.Sprite = { threshold: 2 };
  mouse = new THREE.Vector2();
};

// Render stars
const renderStars = () => {
  if (!props.stars.length || !props.config.domains) return;

  // Clear old
  starSprites.forEach(sprite => scene.remove(sprite));
  starSprites = [];
  starDataMap.clear();
  if (starDust) {
    scene.remove(starDust);
    starDust.geometry.dispose();
    (starDust.material as THREE.Material).dispose();
    starDust = null;
  }

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
    sprite.position.set(star.x, star.y, star.z);

    const scale = star.size * 0.06;
    sprite.scale.set(scale, scale, 1);

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

  // 创建底层星尘
  createStarDust();

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
  if (gpuProfile.bloom && composer) {
    composer.render();
  } else {
    renderer.render(scene, camera);
  }
};

// Handle resize
const handleResize = () => {
  if (!containerRef.value) return;
  const width = containerRef.value.clientWidth;
  const height = containerRef.value.clientHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  if (gpuProfile.bloom && composer) {
    composer.setSize(width, height);
  }
};

// Mouse move
let lastRaycastTime = 0;
const RAYCAST_THROTTLE = 100;

const getAnnotationSprites = (): THREE.Sprite[] => {
  return scene.children.filter((child): child is THREE.Sprite => (
    child instanceof THREE.Sprite && Boolean(child.userData?.interactiveStar)
  ));
};

const getInteractiveStar = (object: THREE.Object3D): StarPoint | null => {
  if (object.userData?.interactiveStar) {
    return object.userData.interactiveStar as StarPoint;
  }
  if (object.userData?.chunk_id) {
    return object.userData as StarPoint;
  }
  return null;
};

const handleMouseMove = (event: MouseEvent) => {
  if (!containerRef.value) return;
  const rect = containerRef.value.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  const now = Date.now();
  if (now - lastRaycastTime < RAYCAST_THROTTLE) return;
  lastRaycastTime = now;

  raycaster.setFromCamera(mouse, camera);
  const annotationIntersects = raycaster.intersectObjects(getAnnotationSprites());
  const intersects = annotationIntersects.length > 0
    ? annotationIntersects
    : raycaster.intersectObjects(starSprites);

  if (intersects.length > 0) {
    const star = getInteractiveStar(intersects[0].object);
    emit('star-hover', star);
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
  const annotationIntersects = raycaster.intersectObjects(getAnnotationSprites());
  const intersects = annotationIntersects.length > 0
    ? annotationIntersects
    : raycaster.intersectObjects(starSprites);

  if (intersects.length > 0) {
    const star = getInteractiveStar(intersects[0].object);
    if (star) {
      emit('star-click', star);
    }
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

  if (starDust) {
    starDust.geometry.dispose();
    (starDust.material as THREE.Material).dispose();
  }

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
