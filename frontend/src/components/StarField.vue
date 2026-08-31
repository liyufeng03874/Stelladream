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
let ambientConnections: THREE.LineSegments | null = null;
let galaxyCoreSprites: THREE.Sprite[] = [];

// Texture cache
const textureCache = new Map<string, THREE.CanvasTexture>();

// chunk_id to star mapping
const starDataMap = new Map<string, {
  sprite: THREE.Sprite;
  data: StarPoint;
  originalMaterial: THREE.SpriteMaterial;
  originalScale: THREE.Vector3;
}>();

interface GalaxyMetrics {
  center: THREE.Vector3;
  maxRadius: number;
  span: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const hash01 = (value: string) => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
};

const getRadialFactor = (position: THREE.Vector3, metrics: GalaxyMetrics) => {
  const distance = position.distanceTo(metrics.center);
  const edge = clamp(distance / Math.max(metrics.maxRadius, 1), 0, 1);
  return {
    edge,
    core: Math.pow(1 - edge, 1.7),
  };
};

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
  gradient.addColorStop(0, 'rgba(255, 255, 255, 0.92)');
  gradient.addColorStop(0.08, 'rgba(255, 255, 255, 0.72)');
  gradient.addColorStop(0.24, color);
  gradient.addColorStop(0.58, color + '36');
  gradient.addColorStop(1, 'transparent');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, textureSize, textureSize);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;

  textureCache.set(color, texture);
  return texture;
};

const createSoftPointTexture = (key: string, size = 64): THREE.CanvasTexture => {
  if (textureCache.has(key)) {
    return textureCache.get(key)!;
  }

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const center = size / 2;
  const gradient = ctx.createRadialGradient(center, center, 0, center, center, center);
  gradient.addColorStop(0, 'rgba(255,255,255,0.95)');
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.42)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  textureCache.set(key, texture);
  return texture;
};

const calculateGalaxyMetrics = (stars: StarPoint[] = props.stars): GalaxyMetrics | null => {
  if (!stars.length) return null;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const center = new THREE.Vector3();
  stars.forEach(star => {
    center.add(new THREE.Vector3(star.x, star.y, star.z));
    minX = Math.min(minX, star.x);
    maxX = Math.max(maxX, star.x);
    minY = Math.min(minY, star.y);
    maxY = Math.max(maxY, star.y);
    minZ = Math.min(minZ, star.z);
    maxZ = Math.max(maxZ, star.z);
  });
  center.divideScalar(stars.length);

  let maxRadius = 1;
  stars.forEach(star => {
    maxRadius = Math.max(maxRadius, new THREE.Vector3(star.x, star.y, star.z).distanceTo(center));
  });

  return {
    center,
    maxRadius,
    span: Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1),
  };
};

const createGalaxyCore = (metrics: GalaxyMetrics) => {
  const texture = createSoftPointTexture('galaxy-core', 128);
  const color = new THREE.Color(0x8edfff);
  const layers = [
    { size: metrics.maxRadius * 0.22, opacity: 0.045 },
    { size: metrics.maxRadius * 0.11, opacity: 0.085 },
  ];

  layers.forEach((layer, index) => {
    const material = new THREE.SpriteMaterial({
      map: texture,
      color,
      transparent: true,
      opacity: layer.opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
    });
    const sprite = new THREE.Sprite(material);
    sprite.position.copy(metrics.center);
    sprite.scale.set(layer.size, layer.size, 1);
    sprite.renderOrder = -5 + index;
    scene.add(sprite);
    galaxyCoreSprites.push(sprite);
  });
};

// 创建底层星尘（极微小暗色粒子）
const createStarDust = (metrics: GalaxyMetrics) => {
  if (!starDataMap.size) return;

  const count = gpuProfile.starDustCount;
  if (count === 0) return; // 无 GPU 时完全关闭星尘
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const radius = Math.pow(Math.random(), 1.2);
    const angle = Math.random() * Math.PI * 2;
    const armAngle = angle + radius * 4.2 + (Math.random() - 0.5) * 0.75;
    const spread = metrics.maxRadius * (0.14 + radius * 0.9);
    const thickness = metrics.maxRadius * clamp(0.16 - radius * 0.1, 0.02, 0.16);

    positions[i * 3] = metrics.center.x + Math.cos(armAngle) * spread + (Math.random() - 0.5) * metrics.maxRadius * 0.18;
    positions[i * 3 + 1] = metrics.center.y + Math.sin(armAngle) * spread * 0.58 + (Math.random() - 0.5) * metrics.maxRadius * 0.08;
    positions[i * 3 + 2] = metrics.center.z + (Math.random() - 0.5) * thickness;

    const color = new THREE.Color().setHSL(0.58, 0.58, 0.28 + (1 - radius) * 0.18 + Math.random() * 0.08);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    map: createSoftPointTexture('star-dust', 32),
    vertexColors: true,
    size: 0.12,
    transparent: true,
    opacity: 0.34,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  });

  starDust = new THREE.Points(geometry, material);
  scene.add(starDust);
};

const createAmbientConnections = (metrics: GalaxyMetrics) => {
  if (gpuProfile.level === 'none') return;

  const maxNodes = gpuProfile.level === 'high' ? 680 : 360;
  const maxSegments = gpuProfile.level === 'high' ? 960 : 420;
  const allStars = Array.from(starDataMap.values())
    .filter((_, index) => index % Math.max(1, Math.floor(starDataMap.size / maxNodes)) === 0)
    .slice(0, maxNodes);

  const positions: number[] = [];
  const colors: number[] = [];
  const innerColor = new THREE.Color(0x8edfff);
  const outerColor = new THREE.Color(0x0c3458);

  for (let i = 0; i < allStars.length && positions.length / 6 < maxSegments; i++) {
    const a = allStars[i].sprite.position;
    const aRadial = getRadialFactor(a, metrics);
    const neighborLimit = aRadial.core > 0.52 ? 3 : aRadial.core > 0.22 ? 2 : 1;
    const distanceLimit = metrics.maxRadius * (0.045 + aRadial.core * 0.032);
    const candidates: { index: number; distance: number }[] = [];

    for (let j = i + 1; j < allStars.length; j++) {
      const b = allStars[j].sprite.position;
      const distance = a.distanceTo(b);
      if (distance <= distanceLimit) {
        candidates.push({ index: j, distance });
      }
    }

    candidates.sort((left, right) => left.distance - right.distance);
    for (const candidate of candidates.slice(0, neighborLimit)) {
      const b = allStars[candidate.index].sprite.position;
      const bRadial = getRadialFactor(b, metrics);
      const centerWeight = (aRadial.core + bRadial.core) * 0.5;
      const color = outerColor.clone().lerp(innerColor, clamp(centerWeight, 0, 0.58));

      positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
      colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

  const material = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.028,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  ambientConnections = new THREE.LineSegments(geometry, material);
  ambientConnections.renderOrder = -8;
  scene.add(ambientConnections);
};

const disposeBaseVisualLayers = () => {
  if (starDust) {
    scene.remove(starDust);
    starDust.geometry.dispose();
    (starDust.material as THREE.Material).dispose();
    starDust = null;
  }

  if (ambientConnections) {
    scene.remove(ambientConnections);
    ambientConnections.geometry.dispose();
    (ambientConnections.material as THREE.Material).dispose();
    ambientConnections = null;
  }

  galaxyCoreSprites.forEach(sprite => {
    scene.remove(sprite);
    sprite.material.dispose();
  });
  galaxyCoreSprites = [];
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
  starSprites.forEach(sprite => {
    scene.remove(sprite);
    sprite.material.dispose();
  });
  starSprites = [];
  starDataMap.clear();
  disposeBaseVisualLayers();

  const metrics = calculateGalaxyMetrics();
  if (!metrics) return;

  // Build mapping and render ALL stars
  props.stars.forEach((star) => {
    const domainConfig = props.config.domains[star.domain];
    const color = domainConfig?.color || '#ffffff';
    const position = new THREE.Vector3(star.x, star.y, star.z);
    const radial = getRadialFactor(position, metrics);
    const variation = 0.82 + hash01(star.chunk_id) * 0.5;
    const sizeByRadius = 0.7 + radial.core * 0.7;
    const brightnessByRadius = 0.36 + radial.core * 0.42;

    const texture = createStarTexture(color);
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      opacity: clamp(star.brightness * brightnessByRadius, 0.16, 0.78),
      blending: THREE.AdditiveBlending,
      depthTest: true,
      depthWrite: false
    });

    const sprite = new THREE.Sprite(material);
    sprite.position.copy(position);

    const scale = clamp(star.size * 0.055 * variation * sizeByRadius, 0.08, 1.15);
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
  createGalaxyCore(metrics);
  createStarDust(metrics);
  createAmbientConnections(metrics);

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

const toScreenPoint = (worldPoint: THREE.Vector3, rect: DOMRect) => {
  const projected = worldPoint.clone().project(camera);
  return {
    x: ((projected.x + 1) * 0.5) * rect.width,
    y: ((1 - projected.y) * 0.5) * rect.height,
    z: projected.z,
  };
};

const hitTestAnnotation = (event: MouseEvent): THREE.Sprite | null => {
  if (!containerRef.value) return null;
  const rect = containerRef.value.getBoundingClientRect();
  const pointerX = event.clientX - rect.left;
  const pointerY = event.clientY - rect.top;
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();

  let bestHit: { sprite: THREE.Sprite; depth: number } | null = null;
  for (const sprite of getAnnotationSprites()) {
    const center = toScreenPoint(sprite.position, rect);
    if (center.z < -1 || center.z > 1) continue;

    const halfWidthPoint = sprite.position.clone().add(right.clone().multiplyScalar(sprite.scale.x * 0.5));
    const halfHeightPoint = sprite.position.clone().add(up.clone().multiplyScalar(sprite.scale.y * 0.5));
    const screenRight = toScreenPoint(halfWidthPoint, rect);
    const screenUp = toScreenPoint(halfHeightPoint, rect);
    const halfWidth = Math.abs(screenRight.x - center.x);
    const halfHeight = Math.abs(screenUp.y - center.y);

    if (
      pointerX >= center.x - halfWidth &&
      pointerX <= center.x + halfWidth &&
      pointerY >= center.y - halfHeight &&
      pointerY <= center.y + halfHeight
    ) {
      if (!bestHit || center.z < bestHit.depth) {
        bestHit = { sprite, depth: center.z };
      }
    }
  }

  return bestHit?.sprite ?? null;
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

  const annotationHit = hitTestAnnotation(event);
  let hoveredObject: THREE.Object3D | null = annotationHit;
  if (!hoveredObject) {
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(starSprites);
    hoveredObject = intersects[0]?.object ?? null;
  }

  if (hoveredObject) {
    const star = getInteractiveStar(hoveredObject);
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

  const annotationHit = hitTestAnnotation(event);
  let clickedObject: THREE.Object3D | null = annotationHit;
  if (!clickedObject) {
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(starSprites);
    clickedObject = intersects[0]?.object ?? null;
  }

  if (clickedObject) {
    const star = getInteractiveStar(clickedObject);
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

  disposeBaseVisualLayers();

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
