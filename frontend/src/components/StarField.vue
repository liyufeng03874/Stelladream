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
  autoRotate?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  autoRotate: true,
});

// ===== 银河核心锚点配置（2026-07-28 视觉升级 · 集中调参） =====
// localStorage.setItem('galaxy', 'off') 可一键回退旧观感（A/B 对照）
const GALAXY = {
  enabled: typeof localStorage !== 'undefined' && localStorage.getItem('galaxy') !== 'off',
  core: {
    sizeFactor: 0.02,      // 核心尺寸 = 相机距离 × 此系数（锁定屏幕大小）
    minSize: 4,
    maxSize: 60,
    glowMultiplier: 6,     // 光晕 = 核心 × 此倍数
    glowOpacity: 0.28,
    glowColor: 0xffe9c4,   // 暖色光晕
  },
  lines: {
    maxRadius: 30,         // 质心处连线半径（大→密）
    minRadius: 8,          // 边缘处连线半径（小→疏）
    maxDegree: 3,          // 每颗星最多连线数
    maxSegments: 30000,    // 总线段上限（性能保护）
    opacity: 0.03,
    color: 0x88aacc,
  },
  dust: {
    concentration: 1.8,    // 向心集中指数（越大越聚拢）
    size: 0.35,
    opacity: 0.5,
    nearColor: 0xfff2d8,   // 质心附近：暖白
    farColor: 0x1a2b4a,    // 边缘：深蓝
  },
  rotate: {
    speed: 0.3,            // 自转速度
  },
};
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

// ===== 银河核心锚点（2026-07-28）=====
const galaxyCenter = new THREE.Vector3(0, 0, 0);   // 数据质心（旋转中心 + 核心位置）
const defaultCamPos = new THREE.Vector3();         // 复位用的默认机位
const defaultTarget = new THREE.Vector3();         // 复位用的默认焦点
let coreSprite: THREE.Sprite | null = null;        // 核心亮星
let glowSprite: THREE.Sprite | null = null;        // 核心光晕
let connectionLines: THREE.LineSegments | null = null;  // 数据连线（中心密边缘疏）
let dustTexture: THREE.CanvasTexture | null = null;     // 星尘中性白纹理
let isResetting = false;                           // 双击复位动画中

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

// 星尘中性白纹理（不带颜色，供 vertexColors 使用）
const getDustTexture = (): THREE.CanvasTexture => {
  if (dustTexture) return dustTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  dustTexture = new THREE.CanvasTexture(canvas);
  dustTexture.needsUpdate = true;
  return dustTexture;
};

// 创建底层星尘（2026-07-28 重构）：径向渐变（质心暖白亮 → 边缘深蓝暗）+ 向心集中
const createStarDust = () => {
  if (!starDataMap.size) return;

  const count = gpuProfile.starDustCount;
  if (count === 0) return; // 无 GPU 时完全关闭星尘
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);

  // 用数据包围盒确定星尘椭球范围（中心用质心）
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  starDataMap.forEach(({ sprite }) => {
    minX = Math.min(minX, sprite.position.x);
    maxX = Math.max(maxX, sprite.position.x);
    minY = Math.min(minY, sprite.position.y);
    maxY = Math.max(maxY, sprite.position.y);
    minZ = Math.min(minZ, sprite.position.z);
    maxZ = Math.max(maxZ, sprite.position.z);
  });
  const radiusX = (maxX - minX) * 0.55;
  const radiusY = (maxY - minY) * 0.55;
  const radiusZ = (maxZ - minZ) * 0.55;

  const nearColor = new THREE.Color(GALAXY.dust.nearColor);
  const farColor = new THREE.Color(GALAXY.dust.farColor);
  const tmpColor = new THREE.Color();

  for (let i = 0; i < count; i++) {
    // t=0 在质心，t=1 在边缘；concentration 指数越大越向心集中
    const t = Math.pow(Math.random(), GALAXY.dust.concentration);
    // 球面随机方向 → 椭球分布
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const dx = Math.sin(phi) * Math.cos(theta);
    const dy = Math.cos(phi);
    const dz = Math.sin(phi) * Math.sin(theta);

    positions[i * 3] = galaxyCenter.x + dx * t * radiusX;
    positions[i * 3 + 1] = galaxyCenter.y + dy * t * radiusY;
    positions[i * 3 + 2] = galaxyCenter.z + dz * t * radiusZ;

    // 颜色：质心附近暖白亮 → 边缘深蓝暗
    tmpColor.copy(farColor).lerp(nearColor, 1 - t);
    colors[i * 3] = tmpColor.r;
    colors[i * 3 + 1] = tmpColor.g;
    colors[i * 3 + 2] = tmpColor.b;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    map: getDustTexture(),
    size: GALAXY.dust.size,
    vertexColors: true,
    transparent: true,
    opacity: GALAXY.dust.opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  });

  starDust = new THREE.Points(geometry, material);
  scene.add(starDust);
};

// 银河核心锚点（2026-07-28）：纯白内核 + 暖色光晕，尺寸随相机距离锁定（任何距离都可见）
const createGalaxyCore = () => {
  if (!GALAXY.enabled) return;

  const coreTex = createStarTexture('#ffffff'); // 中心纯白，触发 Bloom

  coreSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: coreTex,
    transparent: true,
    opacity: 1,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,   // 导航锚点，永远可见
  }));
  coreSprite.position.copy(galaxyCenter);
  coreSprite.renderOrder = 999;

  glowSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: coreTex,
    color: GALAXY.core.glowColor,
    transparent: true,
    opacity: GALAXY.core.glowOpacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  }));
  glowSprite.position.copy(galaxyCenter);
  glowSprite.renderOrder = 998;

  scene.add(coreSprite);
  scene.add(glowSprite);
};

// 数据连线（2026-07-28）：中心密、边缘疏（连线半径随"到质心距离"渐变）
// 均匀网格加速邻居搜索避免 O(n²)；每星最多 maxDegree 条；总量封顶
const createConnectionLines = () => {
  if (!GALAXY.enabled) return;
  if (props.stars.length === 0) return;

  const { maxRadius, minRadius, maxDegree, maxSegments, opacity, color } = GALAXY.lines;
  const n = props.stars.length;

  // 每颗星到质心的距离与最远距离
  const distToCenter = new Float32Array(n);
  let maxDist = 0;
  for (let i = 0; i < n; i++) {
    const p = props.stars[i];
    const d = Math.sqrt(
      (p.x - galaxyCenter.x) ** 2 + (p.y - galaxyCenter.y) ** 2 + (p.z - galaxyCenter.z) ** 2
    );
    distToCenter[i] = d;
    if (d > maxDist) maxDist = d;
  }
  if (maxDist === 0) return;

  // 每颗星的连线半径：质心处 maxRadius（密），边缘 minRadius（疏）
  const radius = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = Math.min(1, distToCenter[i] / maxDist);
    radius[i] = maxRadius - (maxRadius - minRadius) * t;
  }

  // 均匀网格（cell = maxRadius），键 → 星索引
  const cell = maxRadius;
  const grid = new Map<string, number[]>();
  const keyOf = (x: number, y: number, z: number) =>
    `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  for (let i = 0; i < n; i++) {
    const p = props.stars[i];
    const k = keyOf(p.x, p.y, p.z);
    const arr = grid.get(k);
    if (arr) arr.push(i);
    else grid.set(k, [i]);
  }

  const linePositions: number[] = [];
  const degree = new Int32Array(n);
  let segments = 0;
  let done = false;

  for (let i = 0; i < n && !done; i++) {
    if (degree[i] >= maxDegree) continue;
    const a = props.stars[i];
    const cx = Math.floor(a.x / cell);
    const cy = Math.floor(a.y / cell);
    const cz = Math.floor(a.z / cell);
    // 搜 3×3×3 邻域
    for (let ox = -1; ox <= 1 && !done; ox++) {
      for (let oy = -1; oy <= 1 && !done; oy++) {
        for (let oz = -1; oz <= 1 && !done; oz++) {
          const bucket = grid.get(`${cx + ox},${cy + oy},${cz + oz}`);
          if (!bucket) continue;
          for (const j of bucket) {
            if (j <= i) continue;                 // 去重：只处理 j > i
            if (degree[i] >= maxDegree) break;
            if (degree[j] >= maxDegree) continue;
            const b = props.stars[j];
            const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
            const d2 = dx * dx + dy * dy + dz * dz;
            const threshold = Math.min(radius[i], radius[j]); // 取小→中心密边缘疏
            if (d2 < threshold * threshold) {
              linePositions.push(a.x, a.y, a.z, b.x, b.y, b.z);
              degree[i]++;
              degree[j]++;
              segments++;
              if (segments >= maxSegments) { done = true; break; }
            }
          }
        }
      }
    }
  }

  if (linePositions.length === 0) return;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  connectionLines = new THREE.LineSegments(geometry, material);
  scene.add(connectionLines);
};

// 双击复位（2026-07-28）：平滑回到默认机位（可被用户拖拽打断）
const startReset = () => {
  if (!GALAXY.enabled) return;
  isResetting = true;
};
const tickReset = () => {
  if (!isResetting) return;
  camera.position.lerp(defaultCamPos, 0.06);
  controls.target.lerp(defaultTarget, 0.06);
  if (
    camera.position.distanceTo(defaultCamPos) < 1 &&
    controls.target.distanceTo(defaultTarget) < 1
  ) {
    isResetting = false;
  }
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

    // 2026-07-28：以"数据质心"为银河核心位置与旋转中心
    // （bbox 仅用于估算取景距离；质心更贴近数据密集区，作为"家"更合理）
    let camZ = 100;
    if (props.stars.length > 0) {
      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;
      let minZ = Infinity, maxZ = -Infinity;
      let sumX = 0, sumY = 0, sumZ = 0;
      for (const p of props.stars) {
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
        if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
        sumX += p.x; sumY += p.y; sumZ += p.z;
      }
      // 质心（均值）→ 银河核心 & 旋转中心
      galaxyCenter.set(sumX / props.stars.length, sumY / props.stars.length, sumZ / props.stars.length);
      const maxSpan = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
      camZ = maxSpan * 1.3 + 20;
      console.log(`[StarField] data range x:[${minX.toFixed(0)},${maxX.toFixed(0)}] y:[${minY.toFixed(0)},${maxY.toFixed(0)}] z:[${minZ.toFixed(0)},${maxZ.toFixed(0)}]`);
      console.log(`[StarField] galaxy center=(${galaxyCenter.x.toFixed(1)},${galaxyCenter.y.toFixed(1)},${galaxyCenter.z.toFixed(1)}) camZ=${camZ.toFixed(1)}`);
    }

    // 相机从质心斜上方取景（带一点俯角，更有"星系"感）
    camera.position.set(galaxyCenter.x, galaxyCenter.y + camZ * 0.35, galaxyCenter.z + camZ);
    camera.lookAt(galaxyCenter);
    defaultCamPos.copy(camera.position);
    defaultTarget.copy(galaxyCenter);

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
  controls.maxDistance = camZ * 2.5;   // 2026-07-28：收紧最大距离，防止飞到"什么都看不见"
  controls.target.copy(galaxyCenter);
  controls.enablePan = true;
  controls.panSpeed = 0.5;
  // 2026-07-28：闲置时缓慢自转（"流转"），搜索时由 App 经 prop 暂停
  controls.autoRotate = props.autoRotate && GALAXY.enabled;
  controls.autoRotateSpeed = GALAXY.rotate.speed;
  // 用户拖拽时打断复位动画
  controls.addEventListener('start', () => { isResetting = false; });

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
  // 2026-07-28：清理银河核心 / 连线（重建前）
  if (coreSprite) { scene.remove(coreSprite); coreSprite.material.dispose(); coreSprite = null; }
  if (glowSprite) { scene.remove(glowSprite); glowSprite.material.dispose(); glowSprite = null; }
  if (connectionLines) {
    scene.remove(connectionLines);
    connectionLines.geometry.dispose();
    (connectionLines.material as THREE.Material).dispose();
    connectionLines = null;
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

  // 2026-07-28：银河核心锚点 + 数据连线（中心密边缘疏）
  createGalaxyCore();
  createConnectionLines();

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

  // 2026-07-28：复位期间暂停自转，避免互相干扰
  if (isResetting) {
    controls.autoRotate = false;
  } else {
    controls.autoRotate = props.autoRotate && GALAXY.enabled;
  }
  tickReset();

  // 2026-07-28：核心尺寸锁定——按相机距离缩放，任何距离都清晰可见
  if (coreSprite && glowSprite) {
    const dist = camera.position.distanceTo(galaxyCenter);
    const coreScale = THREE.MathUtils.clamp(
      dist * GALAXY.core.sizeFactor,
      GALAXY.core.minSize,
      GALAXY.core.maxSize
    );
    coreSprite.scale.set(coreScale, coreScale, 1);
    const glowScale = coreScale * GALAXY.core.glowMultiplier;
    glowSprite.scale.set(glowScale, glowScale, 1);
  }

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
  containerRef.value?.addEventListener('dblclick', startReset);   // 2026-07-28：双击复位
});

onUnmounted(() => {
  cancelAnimationFrame(animationId);
  window.removeEventListener('resize', handleResize);
  containerRef.value?.removeEventListener('mousemove', handleMouseMove);
  containerRef.value?.removeEventListener('click', handleClick);
  containerRef.value?.removeEventListener('dblclick', startReset);   // 2026-07-28

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

  // 2026-07-28：清理银河核心 / 连线 / 星尘纹理
  if (coreSprite) { coreSprite.material.dispose(); scene.remove(coreSprite); }
  if (glowSprite) { glowSprite.material.dispose(); scene.remove(glowSprite); }
  if (connectionLines) {
    connectionLines.geometry.dispose();
    (connectionLines.material as THREE.Material).dispose();
    scene.remove(connectionLines);
  }
  if (dustTexture) { dustTexture.dispose(); dustTexture = null; }

  renderer.dispose();
  controls.dispose();
  if (composer) composer.dispose();
});

watch(() => props.stars, renderStars, { deep: true });

// 2026-07-28：搜索时由 App 经 prop 暂停自转
watch(() => props.autoRotate, (v) => {
  if (controls) controls.autoRotate = v && GALAXY.enabled;
});
</script>

<style scoped>
.star-field {
  width: 100%;
  height: 100%;
  position: relative;
}
</style>
