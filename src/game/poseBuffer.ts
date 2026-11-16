/** Pose buffer — 每个核心动作存 3–6 个时间关键帧（progress ∈ [0,1]），
 * 所有坐标都是相对于 root.group 的 local space（player 面朝 -z 方向），
 * 由 FencerVisual.update() 作为唯一权威写入点驱动整个角色骨架。
 *
 * 遵循经验 100012755/100012756：
 * - 收敛到单一写入点；保留 IK 解肘（solveElbow）只做局部几何，不改时序；
 * - 小幅度呼吸 / speedBob 通过 pose buffer 基础值 + 增量叠加，不做全量覆盖；
 * - 所有关键帧数值统一用 [米, 弧度]，避免帧计数漂移。
 */
import type { ActionType, Weapon } from './types';

export interface PoseKeyframe {
  t: number;
  // Torso & head
  torsoPos: [number, number, number];
  torsoRot: [number, number, number];
  pelvisPos: [number, number, number];
  headRot: [number, number, number];
  headPos: [number, number, number];
  // Arms — 相对 torso.local
  swordHandTorsoLocal: [number, number, number];
  offHandTorsoLocal: [number, number, number];
  bladeExtension: number;
  // Legs — 分段链从 pelvis 累加
  rightHipPelvisLocal: [number, number, number];
  rightKneeHipLocal: [number, number, number];
  rightAnkleKneeLocal: [number, number, number];
  rightFootYaw: number;
  leftHipPelvisLocal: [number, number, number];
  leftKneeHipLocal: [number, number, number];
  leftAnkleKneeLocal: [number, number, number];
  leftFootYaw: number;
  motionLift: number;
  weightShift: number;
}

export interface PoseSample {
  torsoPos: [number, number, number];
  torsoRot: [number, number, number];
  pelvisPos: [number, number, number];
  headRot: [number, number, number];
  headPos: [number, number, number];
  swordHandTorsoLocal: [number, number, number];
  offHandTorsoLocal: [number, number, number];
  bladeExtension: number;
  // 分段链源
  rightHipPelvisLocal: [number, number, number];
  rightKneeHipLocal: [number, number, number];
  rightAnkleKneeLocal: [number, number, number];
  leftHipPelvisLocal: [number, number, number];
  leftKneeHipLocal: [number, number, number];
  leftAnkleKneeLocal: [number, number, number];
  // 预拼装 root.local（pelvis + 各段累加）
  rightAnkleRootLocal: [number, number, number];
  rightKneeRootLocal: [number, number, number];
  leftAnkleRootLocal: [number, number, number];
  leftKneeRootLocal: [number, number, number];
  rightFootYaw: number;
  leftFootYaw: number;
  motionLift: number;
  weightShift: number;
}

// --- 插值工具 ---
function smoothstep(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}
function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
function lerp3(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function assemble(o: PoseKeyframe): PoseSample {
  const p = o.pelvisPos;
  const rh = o.rightHipPelvisLocal; const lh = o.leftHipPelvisLocal;
  const rk = o.rightKneeHipLocal; const lk = o.leftKneeHipLocal;
  const ra = o.rightAnkleKneeLocal; const la = o.leftAnkleKneeLocal;
  const add = (a: number[], b: number[]): [number, number, number] =>
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  return {
    torsoPos: o.torsoPos, torsoRot: o.torsoRot, pelvisPos: o.pelvisPos,
    headRot: o.headRot, headPos: o.headPos,
    swordHandTorsoLocal: o.swordHandTorsoLocal, offHandTorsoLocal: o.offHandTorsoLocal,
    bladeExtension: o.bladeExtension,
    rightHipPelvisLocal: o.rightHipPelvisLocal,
    rightKneeHipLocal: o.rightKneeHipLocal,
    rightAnkleKneeLocal: o.rightAnkleKneeLocal,
    leftHipPelvisLocal: o.leftHipPelvisLocal,
    leftKneeHipLocal: o.leftKneeHipLocal,
    leftAnkleKneeLocal: o.leftAnkleKneeLocal,
    rightAnkleRootLocal: add(add(p, rh), add(rk, ra)),
    rightKneeRootLocal: add(add(p, rh), rk),
    leftAnkleRootLocal: add(add(p, lh), add(lk, la)),
    leftKneeRootLocal: add(add(p, lh), lk),
    rightFootYaw: o.rightFootYaw, leftFootYaw: o.leftFootYaw,
    motionLift: o.motionLift, weightShift: o.weightShift,
  };
}

function interpolateKeys(keys: PoseKeyframe[], t: number, ease = smoothstep): PoseSample {
  const clamped = Math.max(0, Math.min(1, t));
  let i = 0;
  while (i < keys.length - 1 && keys[i + 1].t < clamped) i += 1;
  const a = keys[i];
  const b = keys[Math.min(keys.length - 1, i + 1)];
  if (a === b) return assemble(a);
  const seg = (clamped - a.t) / Math.max(0.0001, b.t - a.t);
  const e = ease(seg);
  const out: PoseKeyframe = {
    t: clamped,
    torsoPos: lerp3(a.torsoPos, b.torsoPos, e),
    torsoRot: lerp3(a.torsoRot, b.torsoRot, e),
    pelvisPos: lerp3(a.pelvisPos, b.pelvisPos, e),
    headRot: lerp3(a.headRot, b.headRot, e),
    headPos: lerp3(a.headPos, b.headPos, e),
    swordHandTorsoLocal: lerp3(a.swordHandTorsoLocal, b.swordHandTorsoLocal, e),
    offHandTorsoLocal: lerp3(a.offHandTorsoLocal, b.offHandTorsoLocal, e),
    bladeExtension: lerp(a.bladeExtension, b.bladeExtension, e),
    rightHipPelvisLocal: lerp3(a.rightHipPelvisLocal, b.rightHipPelvisLocal, e),
    rightKneeHipLocal: lerp3(a.rightKneeHipLocal, b.rightKneeHipLocal, e),
    rightAnkleKneeLocal: lerp3(a.rightAnkleKneeLocal, b.rightAnkleKneeLocal, e),
    rightFootYaw: lerp(a.rightFootYaw, b.rightFootYaw, e),
    leftHipPelvisLocal: lerp3(a.leftHipPelvisLocal, b.leftHipPelvisLocal, e),
    leftKneeHipLocal: lerp3(a.leftKneeHipLocal, b.leftKneeHipLocal, e),
    leftAnkleKneeLocal: lerp3(a.leftAnkleKneeLocal, b.leftAnkleKneeLocal, e),
    leftFootYaw: lerp(a.leftFootYaw, b.leftFootYaw, e),
    motionLift: lerp(a.motionLift, b.motionLift, e),
    weightShift: lerp(a.weightShift, b.weightShift, e),
  };
  return assemble(out);
}

// 辅助：用模板值 + t + overrides 构造 PoseKeyframe
function kf(t: number, base: Omit<PoseKeyframe, 't'>): PoseKeyframe {
  return { ...base, t };
}

// ============================================================
// 关键帧数据 — 基于身高 1.80m 的击剑选手解剖比例
// 解剖基准：前腿 (right hip +x) 在前、60% 重心在后腿；
// 剑抬至下巴高度，剑尖约眼高；Off-hand 在身体侧后方、肘 90° 预备
// ============================================================

const EN_GARDE: Omit<PoseKeyframe, 't'> = {
  torsoPos: [0, 0.02, 0.01],
  torsoRot: [-0.04, 0.00, 0.00],
  pelvisPos: [0, 0.90, 0.00],
  headRot: [0.00, 0.00, 0.00],
  headPos: [0, 0.74, 0.00],
  swordHandTorsoLocal: [0.09, 0.50, -0.80],
  offHandTorsoLocal: [-0.12, 0.25, 0.45],
  bladeExtension: 0.72,
  rightHipPelvisLocal: [0.115, -0.02, -0.03],
  rightKneeHipLocal: [0.12, -0.38, -0.12],
  rightAnkleKneeLocal: [0.00, -0.34, -0.50],
  rightFootYaw: 0.00,
  leftHipPelvisLocal: [-0.115, -0.02, 0.03],
  leftKneeHipLocal: [-0.13, -0.36, 0.10],
  leftAnkleKneeLocal: [-0.02, -0.34, 0.55],
  leftFootYaw: 0.55,
  motionLift: 0,
  weightShift: -0.2,
};

const BREATHE: Omit<PoseKeyframe, 't'> = {
  ...EN_GARDE,
  torsoPos: [0, 0.025, 0.01],
  pelvisPos: [0, 0.905, 0.00],
  bladeExtension: 0.70,
};

// --- Advance 向前步 ---
const ADVANCE_KEYS: PoseKeyframe[] = [
  kf(0.00, { ...EN_GARDE, weightShift: -0.2, bladeExtension: 0.70 }),
  kf(0.30, {
    ...EN_GARDE,
    torsoPos: [0, 0.02, 0.00],
    torsoRot: [-0.02, 0, 0],
    pelvisPos: [0, 0.90, -0.12],
    swordHandTorsoLocal: [0.09, 0.50, -0.82],
    offHandTorsoLocal: [-0.12, 0.24, 0.44],
    bladeExtension: 0.72,
    rightKneeHipLocal: [0.13, -0.32, -0.26],
    rightAnkleKneeLocal: [0.02, -0.31, -0.32],
    leftKneeHipLocal: [-0.12, -0.40, 0.08],
    leftAnkleKneeLocal: [-0.01, -0.34, 0.40],
    weightShift: 0.15,
  }),
  kf(0.55, {
    ...EN_GARDE,
    torsoPos: [0, 0.018, -0.12],
    torsoRot: [-0.06, 0, 0],
    pelvisPos: [0, 0.89, -0.22],
    swordHandTorsoLocal: [0.09, 0.49, -0.86],
    offHandTorsoLocal: [-0.13, 0.24, 0.42],
    bladeExtension: 0.74,
    rightKneeHipLocal: [0.12, -0.38, -0.24],
    rightAnkleKneeLocal: [0.00, -0.33, -0.70],
    leftKneeHipLocal: [-0.13, -0.36, 0.12],
    leftAnkleKneeLocal: [-0.02, -0.34, 0.45],
    weightShift: 0.35,
  }),
  kf(0.90, { ...EN_GARDE, weightShift: -0.1 }),
  kf(1.00, EN_GARDE),
];

// --- Retreat 向后步 ---
const RETREAT_KEYS: PoseKeyframe[] = [
  kf(0.00, { ...EN_GARDE, weightShift: -0.2 }),
  kf(0.30, {
    ...EN_GARDE,
    torsoPos: [0, 0.022, 0.10],
    torsoRot: [0.03, 0, 0],
    pelvisPos: [0, 0.905, 0.14],
    swordHandTorsoLocal: [0.085, 0.505, -0.77],
    offHandTorsoLocal: [-0.115, 0.24, 0.46],
    bladeExtension: 0.70,
    rightKneeHipLocal: [0.125, -0.36, -0.10],
    rightAnkleKneeLocal: [0.01, -0.34, -0.46],
    leftKneeHipLocal: [-0.13, -0.32, 0.18],
    leftAnkleKneeLocal: [-0.02, -0.30, 0.40],
    weightShift: -0.55,
  }),
  kf(0.60, {
    ...EN_GARDE,
    torsoPos: [0, 0.022, 0.14],
    torsoRot: [0.02, 0, 0],
    pelvisPos: [0, 0.90, 0.20],
    swordHandTorsoLocal: [0.09, 0.50, -0.79],
    bladeExtension: 0.70,
    rightKneeHipLocal: [0.12, -0.38, -0.08],
    rightAnkleKneeLocal: [0.00, -0.34, -0.40],
    leftKneeHipLocal: [-0.13, -0.36, 0.14],
    leftAnkleKneeLocal: [-0.02, -0.34, 0.70],
    weightShift: -0.4,
  }),
  kf(1.00, { ...EN_GARDE, weightShift: -0.2 }),
];

// --- Lunge 弓步 ---
const LUNGE_KEYS: PoseKeyframe[] = [
  kf(0.00, {
    ...EN_GARDE,
    torsoPos: [0, 0.02, 0.04],
    torsoRot: [0.02, 0, 0],
    pelvisPos: [0, 0.91, 0.08],
    swordHandTorsoLocal: [0.09, 0.49, -0.78],
    offHandTorsoLocal: [-0.12, 0.25, 0.44],
    bladeExtension: 0.70,
    rightKneeHipLocal: [0.115, -0.42, -0.10],
    rightAnkleKneeLocal: [0.01, -0.33, -0.40],
    leftKneeHipLocal: [-0.12, -0.40, 0.14],
    weightShift: -0.6,
  }),
  kf(0.15, {
    ...EN_GARDE,
    torsoPos: [0, 0.02, -0.02],
    torsoRot: [-0.06, 0, 0],
    pelvisPos: [0, 0.90, -0.02],
    swordHandTorsoLocal: [0.10, 0.46, -0.92],
    offHandTorsoLocal: [-0.13, 0.22, 0.42],
    bladeExtension: 0.85,
    rightKneeHipLocal: [0.14, -0.18, -0.32],
    rightAnkleKneeLocal: [0.00, -0.28, -0.40],
    leftKneeHipLocal: [-0.10, -0.44, 0.08],
    motionLift: 0.025,
    weightShift: -0.4,
  }),
  kf(0.35, {
    ...EN_GARDE,
    torsoPos: [0, 0.005, -0.30],
    torsoRot: [-0.22, 0, 0],
    pelvisPos: [0, 0.86, -0.38],
    headRot: [0.05, 0, 0], headPos: [0, 0.75, -0.02],
    swordHandTorsoLocal: [0.11, 0.42, -1.20],
    offHandTorsoLocal: [-0.16, 0.10, 0.18],
    bladeExtension: 1.00,
    rightKneeHipLocal: [0.15, -0.36, -0.52],
    rightAnkleKneeLocal: [0.00, -0.14, -0.90],
    leftKneeHipLocal: [-0.10, -0.14, 0.22],
    leftAnkleKneeLocal: [-0.02, -0.32, 0.62],
    leftFootYaw: 0.48,
    weightShift: 0.6,
  }),
  kf(0.55, {
    ...EN_GARDE,
    torsoPos: [0, 0.005, -0.38],
    torsoRot: [-0.26, 0, 0],
    pelvisPos: [0, 0.85, -0.46],
    headRot: [0.06, 0, 0], headPos: [0, 0.75, -0.03],
    swordHandTorsoLocal: [0.11, 0.40, -1.26],
    offHandTorsoLocal: [-0.17, 0.08, 0.14],
    bladeExtension: 1.00,
    rightKneeHipLocal: [0.15, -0.38, -0.58],
    rightAnkleKneeLocal: [0.00, -0.14, -0.98],
    leftKneeHipLocal: [-0.10, -0.06, 0.26],
    leftAnkleKneeLocal: [-0.02, -0.34, 0.68],
    leftFootYaw: 0.40,
    weightShift: 0.85,
  }),
  kf(0.85, {
    ...EN_GARDE,
    torsoPos: [0, 0.015, -0.12],
    torsoRot: [-0.08, 0, 0],
    pelvisPos: [0, 0.89, -0.14],
    swordHandTorsoLocal: [0.09, 0.48, -0.88],
    offHandTorsoLocal: [-0.13, 0.20, 0.36],
    bladeExtension: 0.78,
    rightKneeHipLocal: [0.13, -0.42, -0.30],
    rightAnkleKneeLocal: [0.00, -0.33, -0.55],
    leftKneeHipLocal: [-0.12, -0.38, 0.12],
    weightShift: 0.0,
  }),
  kf(1.00, EN_GARDE),
];

// --- Fleche 冲刺 ---
const FLECHE_KEYS: PoseKeyframe[] = [
  kf(0.00, { ...LUNGE_KEYS[0], weightShift: -0.5 }),
  kf(0.15, {
    ...LUNGE_KEYS[2],
    torsoPos: [0, -0.03, -0.10],
    torsoRot: [-0.38, 0, 0],
    pelvisPos: [0, 0.82, -0.18],
    headRot: [0.08, 0, 0], headPos: [0, 0.76, -0.05],
    swordHandTorsoLocal: [0.12, 0.36, -1.16],
    offHandTorsoLocal: [-0.16, 0.04, 0.18],
    bladeExtension: 1.00,
    rightKneeHipLocal: [0.14, -0.24, -0.44],
    rightAnkleKneeLocal: [0.00, -0.22, -0.70],
    leftKneeHipLocal: [-0.08, -0.46, 0.04],
    leftAnkleKneeLocal: [-0.02, -0.34, 0.44],
    leftFootYaw: 0.40,
    weightShift: 0.7,
  }),
  kf(0.38, {
    ...EN_GARDE,
    torsoPos: [0, -0.03, -0.34],
    torsoRot: [-0.40, 0, 0],
    pelvisPos: [0, 0.82, -0.42],
    headRot: [0.08, 0, 0], headPos: [0, 0.76, -0.05],
    swordHandTorsoLocal: [0.12, 0.36, -1.18],
    offHandTorsoLocal: [-0.17, 0.02, 0.16],
    bladeExtension: 1.00,
    rightKneeHipLocal: [0.10, -0.46, -0.36],
    rightAnkleKneeLocal: [0.00, -0.34, -0.20],
    leftKneeHipLocal: [-0.14, -0.22, -0.50],
    leftAnkleKneeLocal: [-0.02, -0.16, -0.96],
    leftFootYaw: 0.00,
    weightShift: 0.9,
  }),
  kf(0.65, {
    ...EN_GARDE,
    torsoPos: [0, -0.025, -0.58],
    torsoRot: [-0.38, 0, 0],
    pelvisPos: [0, 0.83, -0.66],
    headRot: [0.08, 0, 0], headPos: [0, 0.76, -0.05],
    swordHandTorsoLocal: [0.12, 0.36, -1.18],
    offHandTorsoLocal: [-0.17, 0.02, 0.16],
    bladeExtension: 1.00,
    rightKneeHipLocal: [0.14, -0.22, -0.56],
    rightAnkleKneeLocal: [0.00, -0.14, -1.08],
    leftKneeHipLocal: [-0.10, -0.44, 0.08],
    leftAnkleKneeLocal: [-0.02, -0.34, 0.38],
    leftFootYaw: 0.40,
    weightShift: 0.95,
  }),
  kf(0.88, {
    ...EN_GARDE,
    torsoPos: [0, 0.01, -0.10],
    pelvisPos: [0, 0.89, -0.12],
    rightAnkleKneeLocal: [0.00, -0.34, -0.55],
    leftAnkleKneeLocal: [-0.02, -0.34, 0.50],
    motionLift: 0,
    weightShift: 0.1,
  }),
  kf(1.00, EN_GARDE),
];

// --- Ballestra 跃步 ---
const BALLESTRA_KEYS: PoseKeyframe[] = [
  kf(0.00, { ...EN_GARDE, motionLift: 0, weightShift: -0.2 }),
  kf(0.25, {
    ...EN_GARDE,
    torsoPos: [0, 0.03, -0.08],
    torsoRot: [-0.04, 0, 0],
    pelvisPos: [0, 0.90, -0.10],
    swordHandTorsoLocal: [0.095, 0.48, -0.88],
    offHandTorsoLocal: [-0.13, 0.22, 0.42],
    bladeExtension: 0.82,
    rightKneeHipLocal: [0.12, -0.34, -0.30],
    rightAnkleKneeLocal: [0.01, -0.32, -0.62],
    leftKneeHipLocal: [-0.12, -0.32, 0.20],
    leftAnkleKneeLocal: [-0.02, -0.30, 0.58],
    motionLift: 0.11,
    weightShift: 0.1,
  }),
  kf(0.50, {
    ...EN_GARDE,
    torsoPos: [0, 0.015, -0.14],
    pelvisPos: [0, 0.89, -0.16],
    rightAnkleKneeLocal: [0.00, -0.34, -0.72],
    leftAnkleKneeLocal: [-0.02, -0.34, 0.50],
    motionLift: 0.02,
    weightShift: 0.1,
  }),
  kf(1.00, EN_GARDE),
];

// --- 简单直刺 attack ---
const ATTACK_STRAIGHT_KEYS: PoseKeyframe[] = [
  kf(0.00, { ...EN_GARDE, bladeExtension: 0.70 }),
  kf(0.35, {
    ...EN_GARDE,
    torsoPos: [0, 0.018, -0.04],
    torsoRot: [-0.05, 0, 0],
    pelvisPos: [0, 0.90, -0.02],
    headRot: [0.02, 0, 0],
    swordHandTorsoLocal: [0.10, 0.44, -1.08],
    offHandTorsoLocal: [-0.14, 0.18, 0.34],
    bladeExtension: 1.00,
    rightKneeHipLocal: [0.12, -0.38, -0.14],
    rightAnkleKneeLocal: [0.00, -0.34, -0.52],
    weightShift: 0.1,
  }),
  kf(0.65, {
    ...EN_GARDE,
    torsoRot: [-0.03, 0, 0],
    swordHandTorsoLocal: [0.095, 0.46, -1.00],
    bladeExtension: 0.92,
  }),
  kf(1.00, EN_GARDE),
];

// --- Feint 佯攻 ---
const FEINT_KEYS: PoseKeyframe[] = [
  kf(0.00, { ...EN_GARDE, bladeExtension: 0.70 }),
  kf(0.50, {
    ...EN_GARDE,
    torsoPos: [0, 0.02, -0.02],
    torsoRot: [-0.03, 0, 0],
    pelvisPos: [0, 0.90, -0.01],
    swordHandTorsoLocal: [0.10, 0.47, -0.96],
    offHandTorsoLocal: [-0.13, 0.22, 0.42],
    bladeExtension: 0.88,
    rightKneeHipLocal: [0.12, -0.38, -0.12],
    rightAnkleKneeLocal: [0.00, -0.34, -0.50],
    weightShift: 0.0,
  }),
  kf(1.00, EN_GARDE),
];

// --- Parry：8 个动态生成的格挡姿态（侧偏 + 躯干侧弯 + 剑缩回）---
function makeParryKeyframes(parry: number): PoseKeyframe[] {
  const side = parry % 2 === 1 ? -1 : 1;
  const verticalOffset = (() => {
    if (parry === 1 || parry === 2) return -0.30;
    if (parry === 5 || parry === 6) return 0.22;
    return 0;
  })();
  const lateralExtent = (() => {
    if (parry === 3 || parry === 4) return 0.55;
    if (parry === 5 || parry === 6) return 0.45;
    if (parry === 1 || parry === 2) return 0.40;
    return 0.38;
  })();
  const torsoYaw = side * 0.18;
  const torsoLeanX = verticalOffset > 0 ? -0.05 : verticalOffset < 0 ? 0.06 : 0.00;

  const base: Omit<PoseKeyframe, 't'> = {
    ...EN_GARDE,
    torsoPos: [side * 0.015, EN_GARDE.torsoPos[1], EN_GARDE.torsoPos[2]],
    torsoRot: [EN_GARDE.torsoRot[0] + torsoLeanX, torsoYaw, 0],
    headRot: [0, -torsoYaw * 0.5, 0],
    swordHandTorsoLocal: [0.09 + side * lateralExtent, 0.50 + verticalOffset, -0.72],
    offHandTorsoLocal: [-0.12, 0.25, 0.45],
    bladeExtension: 0.58,
    weightShift: side * 0.15,
  };
  return [
    kf(0.00, EN_GARDE),
    kf(0.25, base),
    kf(0.75, base),
    kf(1.00, EN_GARDE),
  ];
}

// --- Prise de Fer ---
const PRISE_KEYS: PoseKeyframe[] = [
  kf(0.00, EN_GARDE),
  kf(0.50, {
    ...EN_GARDE,
    torsoPos: [0.015, 0.02, -0.02],
    torsoRot: [-0.02, 0.12, 0],
    pelvisPos: [0, 0.90, -0.01],
    swordHandTorsoLocal: [0.12, 0.50, -0.68],
    offHandTorsoLocal: [-0.13, 0.22, 0.42],
    bladeExtension: 0.60,
    weightShift: 0.0,
  }),
  kf(1.00, EN_GARDE),
];

// --- Hit 被击中 ---
const HIT_KEYS: PoseKeyframe[] = [
  kf(0.00, EN_GARDE),
  kf(0.30, {
    ...EN_GARDE,
    torsoPos: [0, 0.025, 0.06],
    torsoRot: [0.14, 0, 0],
    pelvisPos: [0, 0.91, 0.08],
    headRot: [-0.10, 0, 0], headPos: [0, 0.75, 0.02],
    swordHandTorsoLocal: [0.07, 0.52, -0.55],
    offHandTorsoLocal: [-0.10, 0.28, 0.55],
    bladeExtension: 0.35,
    motionLift: 0.01,
    weightShift: -0.55,
  }),
  kf(1.00, EN_GARDE),
];

// ============================================================
// 库
// ============================================================

export const POSE_LIBRARY: Record<ActionType, PoseKeyframe[]> = {
  idle: [kf(0.00, EN_GARDE), kf(1.00, BREATHE)],
  advance: ADVANCE_KEYS,
  retreat: RETREAT_KEYS,
  halfstep: ADVANCE_KEYS,
  glissade: ADVANCE_KEYS,
  lunge: LUNGE_KEYS,
  fleche: FLECHE_KEYS,
  ballestra: BALLESTRA_KEYS,
  attack: ATTACK_STRAIGHT_KEYS,
  feint: FEINT_KEYS,
  parry: [],
  prise: PRISE_KEYS,
  hit: HIT_KEYS,
};

/** 外部查询接口：actionType + progress + parry → PoseSample */
export function samplePose(
  actionType: ActionType,
  progress: number,
  parry?: number,
  weapon?: Weapon,
): PoseSample {
  let keys: PoseKeyframe[];
  if (actionType === 'parry' && parry) {
    keys = makeParryKeyframes(Math.max(1, Math.min(8, parry)));
  } else {
    keys = POSE_LIBRARY[actionType] ?? [kf(0.00, EN_GARDE)];
  }
  void weapon;   // 预留：佩剑侧抬微调，后续按剑种细化
  return interpolateKeys(keys, progress);
}

export function enGardePose(): PoseSample {
  return assemble(kf(0.00, EN_GARDE));
}
