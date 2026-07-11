/**
 * Search Animation Composable
 *
 * Meteor-style rays: bright head with trailing tail, like shooting stars
 * flying from your viewpoint to target stars.
 * ALL groups fire simultaneously with small stagger for visual ripple.
 */

import * as THREE from 'three';
import { gsap } from 'gsap';
import type { StarPoint } from '../api';

interface SearchAnimationContext {
  scene: THREE.Scene;
  camera: THREE.Camera;
  controls: any;
  starSprites: THREE.Sprite[];
  starDataMap: Map<string, { sprite: THREE.Sprite; data: StarPoint }>;
}

const FALLBACK_ORIGIN = new THREE.Vector3(0, 100, 300);

export function useSearchAnimation(context: SearchAnimationContext) {
  const { scene, camera, controls, starSprites, starDataMap } = context;

  let glowSprites: THREE.Sprite[] = [];
  let highlightedSprites = new Map<THREE.Sprite, {
    originalScale: THREE.Vector3;
    originalMaterial: THREE.SpriteMaterial;
  }>();

  function isVectorValid(v: THREE.Vector3): boolean {
    return isFinite(v.x) && isFinite(v.y) && isFinite(v.z);
  }

  /**
   * Get the origin point for meteors.
   * Uses controls.target (scene center) + offset toward camera, NOT camera.position directly.
   * This avoids the issue where camera.position is unstable on first render.
   */
  function getMeteorOrigin(): THREE.Vector3 {
    if (isVectorValid(controls.target)) {
      const center = controls.target.clone();
      // Offset toward camera direction
      if (isVectorValid(camera.position)) {
        const dir = new THREE.Vector3().subVectors(camera.position, center).normalize();
        return center.add(dir.multiplyScalar(20));
      }
      return center.add(new THREE.Vector3(0, 5, 20));
    }
    return FALLBACK_ORIGIN.clone();
  }

  function createGlow(position: THREE.Vector3, color: number, size: number): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    const hexColor = new THREE.Color(color);
    gradient.addColorStop(0, `rgba(${Math.round(hexColor.r * 255)},${Math.round(hexColor.g * 255)},${Math.round(hexColor.b * 255)},0.8)`);
    gradient.addColorStop(0.4, `rgba(${Math.round(hexColor.r * 255)},${Math.round(hexColor.g * 255)},${Math.round(hexColor.b * 255)},0.3)`);
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const glow = new THREE.Sprite(material);
    glow.position.copy(position);
    glow.scale.set(size, size, 1);
    scene.add(glow);
    glowSprites.push(glow);
    return glow;
  }

  /**
   * Create a meteor effect: bright head + trailing tail along a curve
   */
  function createMeteor(from: THREE.Vector3, to: THREE.Vector3, color: number, delayMs: number = 0): Promise<void> {
    if (!isVectorValid(from) || !isVectorValid(to)) {
      return Promise.resolve();
    }

    const hexColor = new THREE.Color(color);

    const curvePoints: THREE.Vector3[] = [];
    const segments = 40;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const x = from.x + (to.x - from.x) * t;
      const z = from.z + (to.z - from.z) * t;
      const y = from.y + (to.y - from.y) * t + Math.sin(t * Math.PI) * 3;
      curvePoints.push(new THREE.Vector3(x, y, z));
    }
    const curve = new THREE.CatmullRomCurve3(curvePoints);

    // Head: small bright sprite
    const headCanvas = document.createElement('canvas');
    headCanvas.width = 16;
    headCanvas.height = 16;
    const headCtx = headCanvas.getContext('2d')!;
    const headGrad = headCtx.createRadialGradient(8, 8, 0, 8, 8, 8);
    headGrad.addColorStop(0, 'rgba(255,255,255,1)');
    headGrad.addColorStop(0.4, `rgba(${Math.round(hexColor.r * 255)},${Math.round(hexColor.g * 255)},${Math.round(hexColor.b * 255)},0.6)`);
    headGrad.addColorStop(1, 'rgba(0,0,0,0)');
    headCtx.fillStyle = headGrad;
    headCtx.fillRect(0, 0, 16, 16);
    const headTexture = new THREE.CanvasTexture(headCanvas);
    const headMat = new THREE.SpriteMaterial({
      map: headTexture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0
    });
    const head = new THREE.Sprite(headMat);
    head.scale.set(0.6, 0.6, 1);
    head.position.copy(from);
    scene.add(head);

    // Trail: growing line behind the head
    const trailMat = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending
    });
    const trailGeo = new THREE.BufferGeometry();
    const trail = new THREE.Line(trailGeo, trailMat);
    scene.add(trail);

    const flightDuration = 0.8;

    return new Promise<void>(resolve => {
      setTimeout(() => {
        const startTimeMs = Date.now();

        const update = () => {
          const t = Math.min((Date.now() - startTimeMs) / (flightDuration * 1000), 1);

          const headPos = curve.getPoint(t);
          if (isVectorValid(headPos)) {
            head.position.copy(headPos);
            head.material.opacity = 1;
          }

          // Trail: all points from 0 to t
          const trailSegments = Math.floor(t * segments);
          if (trailSegments > 0) {
            const positions: number[] = [];
            for (let i = 0; i <= trailSegments; i++) {
              const pt = curvePoints[i];
              positions.push(pt.x, pt.y, pt.z);
            }
            trail.geometry.dispose();
            trail.geometry = new THREE.BufferGeometry();
            trail.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
          }
          trail.material.opacity = 0.6;

          if (t >= 1) {
            gsap.to(head.material, { opacity: 0, duration: 0.2 });
            gsap.to(trail.material, { opacity: 0, duration: 0.4 });
            setTimeout(() => {
              scene.remove(head);
              scene.remove(trail);
              head.geometry?.dispose();
              trail.geometry.dispose();
              head.material.dispose();
              trail.material.dispose();
              resolve();
            }, 400);
            return;
          }

          requestAnimationFrame(update);
        };

        update();
      }, delayMs);
    });
  }

  function highlightAndGrow(chunkIds: string[], color: number, scale: number = 2): THREE.Sprite[] {
    const sprites: THREE.Sprite[] = [];

    chunkIds.forEach(chunkId => {
      const starInfo = starDataMap.get(chunkId);
      if (!starInfo) return;

      const sprite = starInfo.sprite;
      if (!sprite || !isVectorValid(sprite.position)) return;

      if (!highlightedSprites.has(sprite)) {
        highlightedSprites.set(sprite, {
          originalScale: sprite.scale.clone(),
          originalMaterial: sprite.material.clone()
        });
      }

      const newMaterial = sprite.material.clone();
      newMaterial.color.setHex(color);
      newMaterial.opacity = 1;
      newMaterial.blending = THREE.AdditiveBlending;
      sprite.material = newMaterial;

      gsap.to(sprite.scale, {
        x: sprite.scale.x * scale,
        y: sprite.scale.y * scale,
        z: sprite.scale.z * scale,
        duration: 0.8,
        ease: 'power2.out',
        delay: 0.3
      });

      setTimeout(() => {
        createGlow(sprite.position, color, sprite.scale.x * scale * 3);
      }, 400);

      sprites.push(sprite);
    });

    return sprites;
  }

  function cleanup() {
    glowSprites.forEach(glow => {
      scene.remove(glow);
      (glow.material as THREE.Material).dispose();
      if (glow.material instanceof THREE.SpriteMaterial && glow.material.map) {
        glow.material.map.dispose();
      }
    });
    glowSprites = [];

    highlightedSprites.forEach((original, sprite) => {
      sprite.material = original.originalMaterial;
      gsap.killTweensOf(sprite.scale);
      gsap.to(sprite.scale, {
        x: original.originalScale.x,
        y: original.originalScale.y,
        z: original.originalScale.z,
        duration: 0.3
      });
    });
    highlightedSprites.clear();
  }

  function flyToStar(targetPos: THREE.Vector3, duration: number = 2.0) {
    // Use actual camera position - this is where the user is looking from
    const startPos = camera.position.clone();

    if (!isVectorValid(targetPos)) {
      console.warn('[search] flyToStar: invalid targetPos', targetPos);
      return Promise.resolve();
    }

    const dir = new THREE.Vector3().subVectors(targetPos, startPos).normalize();
    const finalCamPos = targetPos.clone().add(dir.clone().multiplyScalar(-30));

    const midPoint = new THREE.Vector3().lerpVectors(startPos, finalCamPos, 0.5);
    midPoint.y += Math.min(15, Math.abs(finalCamPos.y - startPos.y) * 0.2);

    const curve = new THREE.QuadraticBezierCurve3(startPos, midPoint, finalCamPos);

    return new Promise<void>(resolve => {
      const startTime = Date.now();
      const durationMs = duration * 1000;

      const update = () => {
        const t = Math.min((Date.now() - startTime) / durationMs, 1);
        const point = curve.getPoint(t);
        camera.position.copy(point);
        camera.lookAt(targetPos);

        if (t >= 1) {
          resolve();
          return;
        }

        requestAnimationFrame(update);
      };

      update();
    });
  }

  /**
   * Get a stable emission point for meteors and camera flight.
   * This is between the camera and scene center, at a comfortable viewing angle.
   * The key: use this SAME point for both meteor origin AND flight start.
   */
  function getEmissionPoint(): THREE.Vector3 {
    const sceneCenter = isVectorValid(controls.target)
      ? controls.target.clone()
      : new THREE.Vector3(67.1, 96.2, 30.9);

    // Between camera and scene center, but lowered to scene height
    // This gives a side-angle view, not overhead
    const fromCamera = camera.position.clone();
    const fromSceneCenter = sceneCenter.clone();

    // X/Z: midpoint between camera and scene
    const x = (fromCamera.x + fromSceneCenter.x) / 2;
    const z = (fromCamera.z + fromSceneCenter.z) / 2;
    // Y: scene height (not camera height)
    const y = sceneCenter.y + 10;

    return new THREE.Vector3(x, y, z);
  }

  /**
   * Shoot meteors from a consistent emission point.
   */
  function shootMeteors(positions: THREE.Vector3[], color: number, staggerMs: number = 0): Promise<void[]> {
    const origin = getEmissionPoint();
    const promises = positions.map((pos, i) => createMeteor(origin, pos, color, i * staggerMs));
    return Promise.all(promises);
  }

  async function animateSearch(results: {
    bm25: Array<{ chunk_id: string }>;
    knn: Array<{ chunk_id: string }>;
    rrf_top5: Array<{ chunk_id: string }>;
    reranker_final: { chunk_id: string } | null;
  }) {
    console.log('[search] animateSearch start', {
      bm25: results.bm25.length,
      knn: results.knn.length,
      rrf: results.rrf_top5.length,
      reranker: results.reranker_final?.chunk_id || null
    });

    cleanup();

    await new Promise(resolve => setTimeout(resolve, 200));

    // Wait a beat for camera to be in a stable position
    await new Promise(resolve => setTimeout(resolve, 400));

    // Collect all targets and colors
    const bm25Ids = results.bm25.map(r => r.chunk_id);
    const knnIds = results.knn.map(r => r.chunk_id);
    const rrfIds = results.rrf_top5.map(r => r.chunk_id);

    // Highlight all stars first
    const bm25Sprites = highlightAndGrow(bm25Ids.slice(0, 10), 0xFFD700, 2.2);
    const knnSprites = highlightAndGrow(knnIds.slice(0, 10), 0x60A5FA, 2.2);
    const rrfSprites = highlightAndGrow(rrfIds, 0xA78BFA, 2.8);

    const bm25Positions = bm25Sprites.map(s => s.position);
    const knnPositions = knnSprites.map(s => s.position);
    const rrfPositions = rrfSprites.map(s => s.position);

    // ALL meteors fire at once
    shootMeteors(bm25Positions, 0xFFD700, 50);
    shootMeteors(knnPositions, 0x60A5FA, 50);
    shootMeteors(rrfPositions, 0xA78BFA, 50);

    // Wait for all meteors to complete
    await Promise.all([
      Promise.all(bm25Positions.map((_, i) => new Promise<void>(r => setTimeout(r, 800 + i * 50)))),
      Promise.all(knnPositions.map((_, i) => new Promise<void>(r => setTimeout(r, 800 + i * 50)))),
      Promise.all(rrfPositions.map((_, i) => new Promise<void>(r => setTimeout(r, 800 + i * 50)))),
    ]);

    // Final: meteor + grow + fly seamless
    if (results.reranker_final) {
      const finalId = results.reranker_final.chunk_id;
      const finalStar = starDataMap.get(finalId);

      if (!finalStar) {
        console.warn('[search] reranker result not in starDataMap!');
        return;
      }

      // Dim other stars
      highlightedSprites.forEach((original, sprite) => {
        if (sprite !== finalStar.sprite) {
          gsap.to(sprite.material, { opacity: 0.15, duration: 0.4 });
          gsap.to(sprite.scale, {
            x: original.originalScale.x * 1.2,
            y: original.originalScale.y * 1.2,
            z: original.originalScale.z * 1.2,
            duration: 0.4
          });
        }
      });

      gsap.killTweensOf(finalStar.sprite.scale);
      gsap.killTweensOf(finalStar.sprite.material);

      createGlow(finalStar.sprite.position, 0x34D399, 30);

      const flightDuration = 1.8;

      const targetPos = finalStar.sprite.position;
      if (isVectorValid(targetPos)) {
        shootMeteors([targetPos], 0x34D399, 0);
      }

      gsap.to(finalStar.sprite.scale, {
        x: finalStar.sprite.scale.x * 5,
        y: finalStar.sprite.scale.y * 5,
        z: finalStar.sprite.scale.z * 5,
        duration: flightDuration,
        ease: 'power3.out'
      });

      gsap.to(finalStar.sprite.material, {
        opacity: 0.7,
        duration: 0.8,
        ease: 'sine.inOut',
        yoyo: true,
        repeat: Math.floor(flightDuration / 0.8)
      });

      await flyToStar(targetPos, flightDuration);
    }
  }

  return { animateSearch, cleanup };
}
