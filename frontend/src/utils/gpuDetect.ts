/**
 * GPU 自动降级方案
 *
 * 检测当前设备 GPU 能力，返回降级配置。
 * 用于无 GPU 设备（如公司办公电脑）自动关闭 Bloom 后处理、
 * 减少粒子数量、切换渲染路径，保证流畅体验。
 *
 * 检测原理：
 * - 通过 WebGL renderer 字符串判断 GPU 类型
 * - 软件渲染器（SwiftShader/llvmpipe）→ 完全无 GPU
 * - 集成 GPU（Intel HD/UHD）→ 有限 GPU，降强度
 * - 独立 GPU（NVIDIA/AMD）→ 全特效
 */

export interface GPUProfile {
  /** GPU 等级: 'none' | 'low' | 'high' */
  level: 'none' | 'low' | 'high';
  /** 渲染器标识 */
  renderer: string;
  /** 是否启用 Bloom 后处理 */
  bloom: boolean;
  /** 星尘粒子数量（0 = 完全关闭） */
  starDustCount: number;
  /** Bloom 强度 */
  bloomStrength: number;
  /** 像素比上限 */
  maxPixelRatio: number;
  /** 是否使用 Points 代替 Sprite（极简模式） */
  usePoints: boolean;
}

/**
 * 检测当前设备的 GPU 能力，返回对应的降级配置。
 */
export function detectGPUProfile(): GPUProfile {
  try {
    // 创建离屏 canvas 检测 WebGL 渲染器
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');

    if (!gl) {
      // 不支持 WebGL，完全降级
      return {
        level: 'none',
        renderer: 'no WebGL',
        bloom: false,
        starDustCount: 0,
        bloomStrength: 0,
        maxPixelRatio: 1,
        usePoints: true,
      };
    }

    // 获取真实 GPU 型号（需要 WEBGL_debug_renderer_info 扩展）
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    let renderer = 'unknown';

    if (ext) {
      renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
    } else {
      renderer = gl.getParameter(gl.RENDERER);
    }

    const r = renderer.toLowerCase();

    // 软件渲染器关键词（完全无 GPU 加速）
    const isSoftware =
      r.includes('swiftshader') ||   // Chrome 软件渲染
      r.includes('llvmpipe') ||       // Mesa 软件渲染
      r.includes('software') ||
      r.includes('mesa offscreen');

    // 集成/低端 GPU 关键词
    const isIntegrated =
      r.includes('intel') ||          // Intel 核显
      r.includes('mali') ||           // ARM Mali
      r.includes('adreno') ||         // Qualcomm Adreno
      r.includes('powervr');

    // 独立 GPU（NVIDIA / AMD 等）
    const isDiscrete =
      r.includes('nvidia') ||
      r.includes('amd') ||
      r.includes('radeon') ||
      r.includes('geforce') ||
      r.includes('rtx');

    if (isSoftware) {
      // 软件渲染 → 完全降级
      return {
        level: 'none',
        renderer,
        bloom: false,
        starDustCount: 0,
        bloomStrength: 0,
        maxPixelRatio: 1,
        usePoints: true,
      };
    }

    if (isIntegrated) {
      // 集成 GPU → 降级但不完全关
      return {
        level: 'low',
        renderer,
        bloom: true,          // 保留 Bloom，降低强度
        starDustCount: 4000,  // 减少星尘粒子（从 16000 → 4000）
        bloomStrength: 0.08,  // 降低 Bloom 强度（从 0.15 → 0.08）
        maxPixelRatio: 1,
        usePoints: false,
      };
    }

    // 独立 GPU / 未知 → 全特效
    return {
      level: isDiscrete ? 'high' : 'low', // 未知时保守处理
      renderer,
      bloom: true,
      starDustCount: 16000,
      bloomStrength: 0.15,
      maxPixelRatio: 1.5,
      usePoints: false,
    };
  } catch (e) {
    // 检测异常 → 安全降级
    console.warn('[GPU] 检测失败，启用降级模式:', e);
    return {
      level: 'none',
      renderer: 'error',
      bloom: false,
      starDustCount: 0,
      bloomStrength: 0,
      maxPixelRatio: 1,
      usePoints: true,
    };
  }
}

/**
 * 全局 GPU profile 缓存（单例）。
 * 组件直接导入使用，避免重复检测。
 */
export const gpuProfile = detectGPUProfile();

// ====== 调试：手动降级开关 ======
// 在浏览器控制台执行：
//   localStorage.setItem('gpu_level', 'none')  // 无 GPU 模式
//   localStorage.setItem('gpu_level', 'low')   // 集成 GPU 模式
//   localStorage.setItem('gpu_level', 'high')  // 默认（自动检测）
// 然后刷新页面
const debugLevel = localStorage.getItem('gpu_level');
if (debugLevel === 'none' || debugLevel === 'low') {
  console.warn(`[GPU] 调试模式：强制降级为 ${debugLevel}`);
  gpuProfile.level = debugLevel;
  gpuProfile.bloom = false;
  gpuProfile.starDustCount = debugLevel === 'none' ? 0 : 4000;
  gpuProfile.bloomStrength = 0;
  gpuProfile.maxPixelRatio = 1;
  gpuProfile.usePoints = debugLevel === 'none';
}

// 启动时打印 GPU 信息（方便调试）
console.log(
  `[GPU] 检测到: ${gpuProfile.renderer} → 等级: ${gpuProfile.level}` +
  (gpuProfile.level === 'none' ? '（已关闭 Bloom 和星尘）' : '')
);

// ====== 临时调试开关（测试完后删除） ======
// 用法：localStorage.setItem('gpuForce', 'none') 或 'low' 或 'high'
const forceGpu = localStorage.getItem('gpuForce');
if (forceGpu === 'none' || forceGpu === 'low' || forceGpu === 'high') {
  console.warn(`[GPU] 强制降级: ${forceGpu}`);
  gpuProfile.level = forceGpu as 'none' | 'low' | 'high';
  gpuProfile.bloom = forceGpu !== 'none';
  gpuProfile.starDustCount = forceGpu === 'none' ? 0 : forceGpu === 'low' ? 4000 : 16000;
  gpuProfile.bloomStrength = forceGpu === 'none' ? 0 : forceGpu === 'low' ? 0.08 : 0.15;
  gpuProfile.maxPixelRatio = forceGpu === 'high' ? 1.5 : 1;
  gpuProfile.usePoints = forceGpu === 'none';
}
