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
  radiusP50: number;
  radiusP80: number;
  outerRadius: number;
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

const percentile = (values: number[], ratio: number) => {
  if (!values.length) return 1;
  const index = Math.min(values.length - 1, Math.max(0, Math.floor((values.length - 1) * ratio)));
  return values[index];
};

const randomUnitVector = () => {
  const z = Math.random() * 2 - 1;
  const angle = Math.random() * Math.PI * 2;
  const radius = Math.sqrt(1 - z * z);
  return new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, z);
};

const getRadialFactor = (position: THREE.Vector3, metrics: GalaxyMetrics) => {
  const distance = position.distanceTo(metrics.center);
  const edge = clamp(distance / Math.max(metrics.outerRadius, 1), 0, 1);
  return {
    edge,
    core: Math.pow(1 - edge, 2.0),
  };
};

const getStellarColor = (position: THREE.Vector3, metrics: GalaxyMetrics, seedKey: string) => {
  const radial = getRadialFactor(position, metrics);
  const seed = hash01(seedKey);
  const coreBlue = new THREE.Color(0xdffcff);
  const midBlue = new THREE.Color(0x76ddff);
  const edgeBlue = new THREE.Color(0x2f7fc2);
  const deepBlue = new THREE.Color(0x123454);

  let color: THREE.Color;
  if (radial.edge < 0.28) {
    color = coreBlue.clone().lerp(midBlue, radial.edge / 0.28 * 0.55);
  } else if (radial.edge < 0.72) {
    color = midBlue.clone().lerp(edgeBlue, (radial.edge - 0.28) / 0.44);
  } else {
    color = edgeBlue.clone().lerp(deepBlue, (radial.edge - 0.72) / 0.28);
  }

  if (seed > 0.84) {
    color.lerp(new THREE.Color(0xf4ffff), 0.14);
  } else if (seed < 0.16) {
    color.lerp(new THREE.Color(0x8be8ff), 0.1);
  }

  return color;
};

// 星星纹理：中心纯白够亮才能触发 Bloom
const createStarTexture = (key: string = 'stellar-star'): THREE.CanvasTexture => {
  if (textureCache.has(key)) {
    return textureCache.get(key)!;
  }

  const canvas = document.createElement('canvas');
  const textureSize = 64;
  canvas.width = textureSize;
  canvas.height = textureSize;

  const ctx = canvas.getContext('2d')!;
  const center = textureSize / 2;

  const gradient = ctx.createRadialGradient(center, center, 0, center, center, center);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 0.92)');
  gradient.addColorStop(0.1, 'rgba(224, 252, 255, 0.74)');
  gradient.addColorStop(0.32, 'rgba(116, 221, 255, 0.34)');
  gradient.addColorStop(0.68, 'rgba(32, 126, 198, 0.08)');
  gradient.addColorStop(1, 'transparent');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, textureSize, textureSize);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;

  textureCache.set(key, texture);
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
  gradient.addColorStop(0, 'rgba(255,255,255,0.88)');
  gradient.addColorStop(0.35, 'rgba(150,232,255,0.38)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  textureCache.set(key, texture);
  return texture;
};

const createSolarTexture = (): THREE.CanvasTexture => {
  const key = 'stellar-sun';
  if (textureCache.has(key)) {
    return textureCache.get(key)!;
  }

  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const center = size / 2;
  const gradient = ctx.createRadialGradient(center, center, 0, center, center, center);
  gradient.addColorStop(0, 'rgba(255,255,255,0.9)');
  gradient.addColorStop(0.12, 'rgba(226,252,255,0.84)');
  gradient.addColorStop(0.3, 'rgba(116,221,255,0.42)');
  gradient.addColorStop(0.62, 'rgba(23,126,196,0.14)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
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
  const points = stars.map(star => new THREE.Vector3(star.x, star.y, star.z));
  stars.forEach(star => {
    minX = Math.min(minX, star.x);
    maxX = Math.max(maxX, star.x);
    minY = Math.min(minY, star.y);
    maxY = Math.max(maxY, star.y);
    minZ = Math.min(minZ, star.z);
    maxZ = Math.max(maxZ, star.z);
  });
  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);
  const spanZ = Math.max(maxZ - minZ, 1);
  const maxSpan = Math.max(spanX, spanY, spanZ);
  const cellSize = Math.max(maxSpan / 18, 1);
  const grid = new Map<string, { count: number; sum: THREE.Vector3; indices: number[] }>();

  points.forEach((point, index) => {
    const cx = Math.floor((point.x - minX) / cellSize);
    const cy = Math.floor((point.y - minY) / cellSize);
    const cz = Math.floor((point.z - minZ) / cellSize);
    const key = `${cx},${cy},${cz}`;
    if (!grid.has(key)) {
      grid.set(key, { count: 0, sum: new THREE.Vector3(), indices: [] });
    }
    const cell = grid.get(key)!;
    cell.count += 1;
    cell.sum.add(point);
    cell.indices.push(index);
  });

  let densestKey = '';
  let densestCount = -1;
  grid.forEach((cell, key) => {
    if (cell.count > densestCount) {
      densestCount = cell.count;
      densestKey = key;
    }
  });

  const [baseCx, baseCy, baseCz] = densestKey.split(',').map(v => Number(v));
  const clusterPoints: THREE.Vector3[] = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        const neighborKey = `${baseCx + dx},${baseCy + dy},${baseCz + dz}`;
        const cell = grid.get(neighborKey);
        if (!cell) continue;
        cell.indices.forEach(index => clusterPoints.push(points[index]));
      }
    }
  }

  const centerSource = clusterPoints.length ? clusterPoints : points;
  const center = centerSource.reduce((sum, point) => sum.add(point), new THREE.Vector3()).divideScalar(centerSource.length);

  const distances = points
    .map(point => point.distanceTo(center))
    .sort((left, right) => left - right);
  const radiusP50 = Math.max(1, percentile(distances, 0.5));
  const radiusP80 = Math.max(radiusP50, percentile(distances, 0.8));
  const outerRadius = Math.max(radiusP80, percentile(distances, 0.96));
  const maxRadius = Math.max(outerRadius, distances[distances.length - 1] || 1);

  return {
    center,
    maxRadius,
    radiusP50,
    radiusP80,
    outerRadius,
    span: maxSpan,
  };
};

const createGalaxyCore = (metrics: GalaxyMetrics) => {
  const texture = createSolarTexture();
  const coreSize = clamp(metrics.radiusP50 * 0.065, 3.0, 6.2);
  const layers = [
    { size: coreSize * 6.4, opacity: 0.015, color: 0x2f8fff, pulse: 0.04 },
    { size: coreSize * 2.6, opacity: 0.045, color: 0x63dbff, pulse: 0.03 },
    { size: coreSize, opacity: 0.28, color: 0xe6fbff, pulse: 0.02 },
  ];

  layers.forEach((layer, index) => {
    const material = new THREE.SpriteMaterial({
      map: texture,
      color: layer.color,
      transparent: true,
      opacity: layer.opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
    });
    const sprite = new THREE.Sprite(material);
    sprite.position.copy(metrics.center);
    sprite.scale.set(layer.size, layer.size, 1);
    sprite.renderOrder = -9 + index;
    sprite.userData.baseScale = layer.size;
    sprite.userData.baseOpacity = layer.opacity;
    sprite.userData.pulse = layer.pulse;
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
  const stars = Array.from(starDataMap.values()).map(info => {
    const radial = getRadialFactor(info.sprite.position, metrics);
    return {
      position: info.sprite.position,
      color: getStellarColor(info.sprite.position, metrics, info.data.chunk_id),
      radial,
      weight: 0.14 + radial.core * 3.1 + Math.pow(1 - radial.edge, 1.4) * 0.6,
    };
  });
  let totalWeight = 0;
  const cumulativeWeights = stars.map(star => {
    totalWeight += star.weight;
    return totalWeight;
  });

  const pickStar = () => {
    let target = Math.random() * totalWeight;
    let low = 0;
    let high = cumulativeWeights.length - 1;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (cumulativeWeights[mid] < target) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    return stars[low];
  };

  for (let i = 0; i < count; i++) {
    const anchor = pickStar();
    const radialDirection = anchor.position.clone().sub(metrics.center);
    if (radialDirection.lengthSq() < 0.001) {
      radialDirection.copy(randomUnitVector());
    } else {
      radialDirection.normalize();
    }
    const dustRadius = clamp(metrics.radiusP50 * (0.01 + anchor.radial.edge * 0.01), 0.28, 3.4);
    const offset = randomUnitVector()
      .multiplyScalar(dustRadius * Math.pow(Math.random(), 0.55))
      .add(radialDirection.multiplyScalar(dustRadius * (Math.random() - 0.3) * anchor.radial.core));

    positions[i * 3] = anchor.position.x + offset.x;
    positions[i * 3 + 1] = anchor.position.y + offset.y;
    positions[i * 3 + 2] = anchor.position.z + offset.z;

    const color = anchor.color.clone()
      .lerp(new THREE.Color(0x78e8ff), anchor.radial.edge * 0.22)
      .multiplyScalar(0.3 + anchor.radial.core * 0.24 + Math.random() * 0.12);
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
    size: 0.062,
    transparent: true,
    opacity: 0.19,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  });

  starDust = new THREE.Points(geometry, material);
  scene.add(starDust);
};

const createAmbientConnections = (metrics: GalaxyMetrics) => {
  if (gpuProfile.level === 'none') return;

  const maxNodes = gpuProfile.level === 'high' ? 720 : 380;
  const maxSegments = gpuProfile.level === 'high' ? 860 : 360;
  const allStars = Array.from(starDataMap.values())
    .filter((_, index) => index % Math.max(1, Math.floor(starDataMap.size / maxNodes)) === 0)
    .slice(0, maxNodes);

  const positions: number[] = [];
  const colors: number[] = [];

  for (let i = 0; i < allStars.length && positions.length / 6 < maxSegments; i++) {
    const aInfo = allStars[i];
    const a = aInfo.sprite.position;
    const aRadial = getRadialFactor(a, metrics);
    const neighborLimit = aRadial.core > 0.5 ? 4 : aRadial.core > 0.2 ? 3 : 1;
    const distanceLimit = metrics.radiusP50 * (0.085 + aRadial.core * 0.1);
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
      const bInfo = allStars[candidate.index];
      const b = bInfo.sprite.position;
      const bRadial = getRadialFactor(b, metrics);
      const centerWeight = (aRadial.core + bRadial.core) * 0.5;
      const edgeProbability = 0.28 + centerWeight * 0.58;
      if (hash01(`${aInfo.data.chunk_id}|${bInfo.data.chunk_id}`) > edgeProbability) continue;

      const color = getStellarColor(a, metrics, aInfo.data.chunk_id)
        .lerp(getStellarColor(b, metrics, bInfo.data.chunk_id), 0.5)
        .multiplyScalar(0.4 + centerWeight * 0.34);

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
    opacity: 0.03,
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

const updateGalaxyCore = () => {
  if (!galaxyCoreSprites.length) return;
  const elapsed = performance.now() * 0.001;
  galaxyCoreSprites.forEach((sprite, index) => {
    const baseScale = sprite.userData.baseScale as number | undefined;
    const baseOpacity = sprite.userData.baseOpacity as number | undefined;
    const pulse = sprite.userData.pulse as number | undefined;
    if (!baseScale || !baseOpacity || !pulse) return;

    const wave = Math.sin(elapsed * (0.55 + index * 0.13));
    const scale = baseScale * (1 + wave * pulse);
    sprite.scale.set(scale, scale, 1);
    sprite.material.opacity = baseOpacity * (1 + wave * pulse * 0.55);
  });
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
      const metrics = calculateGalaxyMetrics();
      centerX = metrics?.center.x ?? (minX + maxX) / 2;
      centerY = metrics?.center.y ?? (minY + maxY) / 2;
      centerZ = metrics?.center.z ?? (minZ + maxZ) / 2;
      const spanX = maxX - minX;
      const spanY = maxY - minY;
      const spanZ = maxZ - minZ;
      const maxSpan = Math.max(spanX, spanY, spanZ);
      camZ = Math.max(maxSpan * 1.3, (metrics?.outerRadius ?? 0) * 1.8) + 20;
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
    const position = new THREE.Vector3(star.x, star.y, star.z);
    const radial = getRadialFactor(position, metrics);
    const seed = hash01(star.chunk_id);
    const color = getStellarColor(position, metrics, star.chunk_id);
    const variation = 0.78 + seed * 0.62;
    const sizeByRadius = 0.62 + radial.core * 0.95;
    const brightnessByRadius = 0.2 + radial.core * 0.42 + (1 - radial.edge) * 0.08;

    const texture = createStarTexture();
    const material = new THREE.SpriteMaterial({
      map: texture,
      color,
      transparent: true,
      opacity: clamp(star.brightness * brightnessByRadius, 0.06, 0.72),
      blending: THREE.AdditiveBlending,
      depthTest: true,
      depthWrite: false
    });

    const sprite = new THREE.Sprite(material);
    sprite.position.copy(position);

    const scale = clamp(star.size * 0.05 * variation * sizeByRadius, 0.06, 1.1);
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
  updateGalaxyCore();
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
