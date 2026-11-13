/** 单点可调的击剑体感参数。把距离尺度、弓步硬直、步速收敛到一处，
 * 所有业务入口只引用本模块。按经验 100006485：
 * - 体感参数集中配置，避免散落硬编码多点漂移；
 * - 时间参数显式标单位（秒、米、米/秒），不混用帧计数。
 */
export type CombatPreset = 'tight' | 'balanced' | 'loose';

export interface CombatParams {
  /** 预备线身体距离（米） */
  startingGap: number;
  /** 身体绝对不重叠距离（米） */
  minBodyGap: number;

  // --- 步法速度（米/秒） ---
  advanceSpeed: number;
  retreatSpeed: number;
  glissadeSpeed: number;
  halfstepSpeed: number;
  ballestraSpeed: number;
  lungeForwardSpeed: number;   // 弓步前冲峰值速度
  flecheForwardSpeed: number;

  // --- 区域阈值（米，身体间距） ---
  safeThreshold: number;       // > 此值 = 安全
  threatThreshold: number;     // <= 安全 且 > 此值 = 威胁
  lungeThreshold: number;      // <= 威胁 且 > 此值 = 弓步
  innerThreshold: number;      // <= 此值 = 内围

  // --- AI 感知阈值（米，身体间距） ---
  aiThreatSense: number;       // AI 认为玩家正在威胁自己
  aiOpenSense: number;         // AI 认为玩家收剑后可抢攻

  // --- 弓步 ---
  lungeDuration: number;       // 总时长（含起手 + 击中 + 恢复）
  lungeHitAt: number;          // 击中窗口起点
  lungePeakAt: number;         // 前冲峰值时刻
  lungeAdvanceEnd: number;     // 前冲位移截止时刻
  lungeHoldTime: number;       // 击中后剑保持伸直时间
  lungeRecoveryTime: number;   // 收剑恢复到 idle 的时长
  remiseWindow: number;        // hitAt 后多久还能续第二刀（秒）

  // --- 冲刺 ---
  flecheDuration: number;
  flecheHitAt: number;
  flecheAdvanceEnd: number;

  // --- 简单直刺 ---
  thrustDurationFast: number;   // Riposte 时
  thrustDurationSlow: number;  // 普通直刺
  thrustHitAtFast: number;
  thrustHitAtSlow: number;
  riposteWindow: number;        // lastParry 后多久仍算 Riposte

  // --- 佯攻 ---
  feintDuration: number;

  // --- 格挡 ---
  parryDuration: number;
  parryActiveStart: number;
  parryActiveEnd: number;
  parryBladeMaxDistance: number;

  // --- 压剑 ---
  priseMaxBodyDistance: number;
  priseBladeMaxDistance: number;
  priseDuration: number;
}

/** Tight = 距离吃紧、弓步惩罚重；Loose = 距离宽松、弓步恢复快 */
const presets: Record<CombatPreset, CombatParams> = {
  tight: {
    startingGap: 4.4, minBodyGap: 0.64,
    advanceSpeed: 1.08, retreatSpeed: 1.18, glissadeSpeed: 0.72, halfstepSpeed: 0.68,
    ballestraSpeed: 2.05, lungeForwardSpeed: 3.0, flecheForwardSpeed: 4.2,
    safeThreshold: 3.5, threatThreshold: 2.5, lungeThreshold: 1.5, innerThreshold: 1.2,
    aiThreatSense: 3.0, aiOpenSense: 3.0,
    lungeDuration: 1.1, lungeHitAt: 0.24, lungePeakAt: 0.30, lungeAdvanceEnd: 0.48,
    lungeHoldTime: 0.17, lungeRecoveryTime: 0.69, remiseWindow: 0.14,
    flecheDuration: 1.08, flecheHitAt: 0.30, flecheAdvanceEnd: 0.60,
    thrustDurationFast: 0.58, thrustDurationSlow: 0.70, thrustHitAtFast: 0.14, thrustHitAtSlow: 0.18, riposteWindow: 1.05,
    feintDuration: 0.48,
    parryDuration: 0.43, parryActiveStart: 0.06, parryActiveEnd: 0.25, parryBladeMaxDistance: 0.72,
    priseMaxBodyDistance: 2.5, priseBladeMaxDistance: 0.38, priseDuration: 0.58,
  },
  balanced: {
    startingGap: 4.4, minBodyGap: 0.64,
    advanceSpeed: 1.08, retreatSpeed: 1.18, glissadeSpeed: 0.72, halfstepSpeed: 0.68,
    ballestraSpeed: 2.05, lungeForwardSpeed: 3.0, flecheForwardSpeed: 4.2,
    safeThreshold: 3.5, threatThreshold: 2.5, lungeThreshold: 1.5, innerThreshold: 1.2,
    aiThreatSense: 3.0, aiOpenSense: 3.0,
    lungeDuration: 1.0, lungeHitAt: 0.23, lungePeakAt: 0.32, lungeAdvanceEnd: 0.48,
    lungeHoldTime: 0.18, lungeRecoveryTime: 0.59, remiseWindow: 0.15,
    flecheDuration: 1.06, flecheHitAt: 0.29, flecheAdvanceEnd: 0.60,
    thrustDurationFast: 0.57, thrustDurationSlow: 0.69, thrustHitAtFast: 0.14, thrustHitAtSlow: 0.17, riposteWindow: 1.05,
    feintDuration: 0.48,
    parryDuration: 0.43, parryActiveStart: 0.06, parryActiveEnd: 0.25, parryBladeMaxDistance: 0.72,
    priseMaxBodyDistance: 2.5, priseBladeMaxDistance: 0.38, priseDuration: 0.58,
  },
  loose: {
    startingGap: 4.4, minBodyGap: 0.64,
    advanceSpeed: 1.08, retreatSpeed: 1.18, glissadeSpeed: 0.72, halfstepSpeed: 0.68,
    ballestraSpeed: 2.05, lungeForwardSpeed: 3.0, flecheForwardSpeed: 4.2,
    safeThreshold: 3.5, threatThreshold: 2.5, lungeThreshold: 1.5, innerThreshold: 1.2,
    aiThreatSense: 3.0, aiOpenSense: 3.0,
    lungeDuration: 0.88, lungeHitAt: 0.20, lungePeakAt: 0.32, lungeAdvanceEnd: 0.46,
    lungeHoldTime: 0.18, lungeRecoveryTime: 0.47, remiseWindow: 0.16,
    flecheDuration: 1.02, flecheHitAt: 0.27, flecheAdvanceEnd: 0.59,
    thrustDurationFast: 0.55, thrustDurationSlow: 0.66, thrustHitAtFast: 0.13, thrustHitAtSlow: 0.17, riposteWindow: 1.0,
    feintDuration: 0.48,
    parryDuration: 0.42, parryActiveStart: 0.06, parryActiveEnd: 0.24, parryBladeMaxDistance: 0.72,
    priseMaxBodyDistance: 2.5, priseBladeMaxDistance: 0.38, priseDuration: 0.58,
  },
};

export class CombatConfig {
  preset: CombatPreset;
  params: CombatParams;

  constructor(preset: CombatPreset = 'tight') {
    this.preset = preset;
    this.params = { ...presets[preset] };
  }

  setPreset(preset: CombatPreset) {
    this.preset = preset;
    this.params = { ...presets[preset] };
  }

  // 弓步内部子阶段派生值
  get lungeAdvanceDuration() { return this.params.lungeAdvanceEnd - 0.07; } // 从 0.07s 开始前冲
  get lungeRecoveryDuration() { return this.params.lungeDuration - this.params.lungeHitAt - this.params.lungeHoldTime; }

  // 简单工具函数
  zoneOf(bodyDistance: number): '安全距离' | '威胁距离' | '弓步距离' | '内围距离' {
    const p = this.params;
    if (bodyDistance > p.safeThreshold) return '安全距离';
    if (bodyDistance > p.threatThreshold) return '威胁距离';
    if (bodyDistance > p.lungeThreshold) return '弓步距离';
    return '内围距离';
  }
}

export const COMBAT_PRESET_INFO: Record<CombatPreset, { label: string; french: string; description: string }> = {
  tight: {
    label: '硬核写实',
    french: 'REALIST',
    description: '弓步惩罚重，前冲 0.82m、恢复 0.69s。AI 感知更敏锐，适合硬核模拟。',
  },
  balanced: {
    label: '竞技平衡',
    french: 'BALANCÉ',
    description: '弓步总时长 1.0s，恢复 0.59s。适合普通竞技体验。',
  },
  loose: {
    label: '轻松上手',
    french: 'DÉTENDU',
    description: '弓步总时长 0.88s，恢复 0.47s。容错高，适合新手熟悉节奏。',
  },
};
