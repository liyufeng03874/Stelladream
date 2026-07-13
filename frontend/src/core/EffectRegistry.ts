/**
 * EffectRegistry — 变更注册中心
 * 
 * 记录所有视觉属性变更的完整历史，包括覆盖链。
 * 不持有 Three.js 对象引用（避免内存泄漏），只记录元数据。
 */

export type EffectStatus = 'applied' | 'overridden' | 'restored' | 'disposed';

export interface EffectEntry {
  id: string;
  targetId: string;
  effectType: string;       // 'glow' | 'meteor' | 'scale' | 'material' | 'opacity' | 'blending' | 'camera'
  property: string;         // 'size' | 'color' | 'scale' | 'opacity' | 'blending' | 'position'
  prevValue: any;
  value: any;
  source: string;           // 发起函数
  phase: string;            // 阶段标识
  timestamp: number;
  status: EffectStatus;
  chainId?: string;         // 同一属性的覆盖链ID
}

export interface EffectAddParams {
  targetId: string;
  effectType: string;
  property: string;
  prevValue: any;
  value: any;
  source: string;
  phase: string;
}

let _nextId = 0;
function genId(): string {
  return `eff_${Date.now()}_${++_nextId}`;
}

export class EffectRegistry {
  private entries: Map<string, EffectEntry[]> = new Map();
  private objectMap: Map<string, any> = new Map();  // targetId → Three.js 对象（非持久化，仅运行时用）

  /** 注册一次属性变更 */
  add(params: EffectAddParams): string {
    const id = genId();
    const { targetId, property, source, phase } = params;

    // 查找该 targetId + property 的最后一条记录，建立覆盖链
    const history = this.entries.get(targetId) || [];
    const lastForProperty = history
      .filter(e => e.property === property && e.status === 'applied')
      .pop();

    const entry: EffectEntry = {
      id,
      targetId,
      effectType: params.effectType,
      property,
      prevValue: params.prevValue,
      value: params.value,
      source,
      phase,
      timestamp: Date.now(),
      status: 'applied',
      chainId: lastForProperty?.chainId || lastForProperty?.id,
    };

    // 标记旧记录为 overridden
    if (lastForProperty) {
      lastForProperty.status = 'overridden';
    }

    history.push(entry);
    this.entries.set(targetId, history);
    return id;
  }

  /** 获取某个目标的所有变更历史 */
  getHistory(targetId: string): EffectEntry[] {
    return this.entries.get(targetId) || [];
  }

  /** 获取某个目标的某个属性的最新有效记录 */
  getLatest(targetId: string, property: string): EffectEntry | null {
    const history = this.entries.get(targetId) || [];
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].property === property && history[i].status === 'applied') {
        return history[i];
      }
    }
    return null;
  }

  /** 获取某个属性的覆盖链 */
  getOverrideChain(targetId: string, property: string): EffectEntry[] {
    const history = this.entries.get(targetId) || [];
    const chain: EffectEntry[] = [];
    // 找到最新的 applied 记录
    let current: EffectEntry | null = null;
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].property === property && history[i].status === 'applied') {
        current = history[i];
        break;
      }
    }
    // 沿 chainId 回溯
    while (current) {
      chain.push(current);
      if (!current.chainId) break;
      current = history.find(e => e.id === current!.chainId) || null;
    }
    return chain.reverse();
  }

  /** 标记某个条目被覆盖 */
  markOverridden(entryId: string): void {
    for (const entries of this.entries.values()) {
      const entry = entries.find(e => e.id === entryId);
      if (entry) {
        entry.status = 'overridden';
        return;
      }
    }
  }

  /** 标记某个目标的所有记录为 restored（恢复原始状态） */
  markRestored(targetId: string): void {
    const history = this.entries.get(targetId);
    if (history) {
      history.forEach(e => {
        if (e.status === 'applied') e.status = 'restored';
      });
    }
  }

  /** 标记某个目标的记录为 disposed（对象已销毁） */
  markDisposed(targetId: string): void {
    const history = this.entries.get(targetId);
    if (history) {
      history.forEach(e => {
        if (e.status === 'applied') e.status = 'disposed';
      });
    }
  }

  /** 获取按 phase 过滤的所有活跃条目 */
  getByPhase(phase: string): EffectEntry[] {
    const result: EffectEntry[] = [];
    for (const entries of this.entries.values()) {
      for (const e of entries) {
        if (e.phase === phase && e.status === 'applied') {
          result.push(e);
        }
      }
    }
    return result;
  }

  /** 获取按 source 过滤的所有活跃条目 */
  getBySource(source: string): EffectEntry[] {
    const result: EffectEntry[] = [];
    for (const entries of this.entries.values()) {
      for (const e of entries) {
        if (e.source === source && e.status === 'applied') {
          result.push(e);
        }
      }
    }
    return result;
  }

  /** 注册 targetId → Three.js 对象映射 */
  registerObject(targetId: string, obj: any): void {
    this.objectMap.set(targetId, obj);
  }

  /** 获取关联的 Three.js 对象 */
  getObject<T = any>(targetId: string): T | undefined {
    return this.objectMap.get(targetId) as T;
  }

  /** 注销对象映射 */
  unregisterObject(targetId: string): void {
    this.objectMap.delete(targetId);
  }

  /** 清空所有记录 */
  clear(): void {
    this.entries.clear();
    this.objectMap.clear();
  }

  /** 导出完整记录（调试用） */
  export(): Record<string, EffectEntry[]> {
    const result: Record<string, EffectEntry[]> = {};
    for (const [targetId, entries] of this.entries.entries()) {
      result[targetId] = [...entries];
    }
    return result;
  }

  /** 打印差异比对（调试用） */
  diff(targetIdA: string, targetIdB: string): {
    onlyInA: EffectEntry[];
    onlyInB: EffectEntry[];
    different: { a: EffectEntry; b: EffectEntry }[];
  } {
    const historyA = this.getHistory(targetIdA);
    const historyB = this.getHistory(targetIdB);

    const appliedA = historyA.filter(e => e.status === 'applied');
    const appliedB = historyB.filter(e => e.status === 'applied');

    const onlyInA = appliedA.filter(a => !appliedB.some(b => b.property === a.property));
    const onlyInB = appliedB.filter(b => !appliedA.some(a => a.property === b.property));
    const different: { a: EffectEntry; b: EffectEntry }[] = [];

    for (const a of appliedA) {
      const b = appliedB.find(x => x.property === a.property);
      if (b && JSON.stringify(b.value) !== JSON.stringify(a.value)) {
        different.push({ a, b });
      }
    }

    return { onlyInA, onlyInB, different };
  }

  /** 输出简短摘要（控制台友好） */
  summary(): string[] {
    const lines: string[] = [];
    lines.push(`=== EffectRegistry Summary ===`);
    lines.push(`Total targets: ${this.entries.size}`);

    for (const [targetId, entries] of this.entries.entries()) {
      const applied = entries.filter(e => e.status === 'applied');
      if (applied.length === 0) continue;

      const sources = [...new Set(applied.map(e => e.source))];
      const phases = [...new Set(applied.map(e => e.phase))];
      lines.push(`\n[${targetId}] (${applied.length} changes, sources: ${sources.join(', ')}, phases: ${phases.join(', ')})`);

      const properties = [...new Set(applied.map(e => e.property))];
      for (const prop of properties) {
        const latest = this.getLatest(targetId, prop);
        if (latest) {
          lines.push(`  ${prop}: ${JSON.stringify(latest.value)} (via ${latest.source}, ${latest.phase})`);
        }
      }
    }

    return lines;
  }
}
