/**
 * 2D 侧视角渲染器 — 所有战斗逻辑、hit detection、优先权判定复用 FencingGame.ts；
 * 只替换渲染层，用 Canvas2D 画剑士、剑道、裁判灯、距离指示。
 *
 * 坐标约定：
 *   游戏世界：z = 剑道长轴（player +z 朝对手，AI -z 朝对手），y = 高度，x = 横向
 *   Canvas：x = 剑道横轴（player 左 AI 右），y = 屏幕向下（world y 反相）
 *
 * 人体关节全部从 poseBuffer 提取，避免 3D 坐标多次转换的误差。
 */
import { samplePose, enGardePose } from './poseBuffer';
import type { PoseSample } from './poseBuffer';
import type { ActionType, Side, ViewMode, Weapon } from './types';
import type { FencerSnapshot } from './types';

// --- 世界坐标 → Canvas ---
// 剑道总长 ~14m，两侧各 0.5m 边界，画布中心在原点
const PISTE_HALF = 6.8; // ±6.8m 可用（游戏内 clamp 到 ±6.65）

// --- 解剖基准（米）---
// poseBuffer 坐标系：x=lateral, y=height, z=forward(-z=player前/对手方向)
// 2D 侧视角：画面横向 = pose.z（前/后），画面纵向 = pose.y（高度）
// 所以所有 joint.x 取 pose.z，joint.y 取 pose.y
// AI 面朝 +z（与 poseBuffer 默认 -z 相反），需要把 pose.z 全部取反
const PELVIS_Y_WORLD = 0.90;
const SHOULDER_TORSO_LOCAL_Y = 1.60; // torso 原点 ≈ 0.02 motion-local
const HEAD_TORSO_LOCAL_Y = 1.68;

// pose 的 [x,y,z] → [canvas_forward, height]
// 即：pose.z = 画面横向（前/后方向），pose.y = 画面纵向（高度）
// sideSign: player 面朝 -z → -1；AI 面朝 +z → +1
function poseZ(v: [number, number, number], sideSign: number): number {
  // player: pose.z 保持（前伸 = pose.z 负 = canvas forward 负方向）
  // AI: pose.z 镜像（因为 AI 面朝 +z，poseBuffer 默认面朝 -z）
  const mirroredZ = sideSign === 1 ? -v[2] : v[2];
  return mirroredZ;
}
function poseY(v: [number, number, number]): number { return v[1]; }

// --- 工具 ---
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// ============================================================
// 关节坐标提取（全部来自 poseBuffer，转换到 motion.root local）
// ============================================================
interface Joints {
  // 所有坐标都在 motion.root local 下（root.position = game.position）
  pelvis: { x: number; y: number };
  torsoBottom: { x: number; y: number }; // jacket 下沿 ≈ 腰
  torsoTop: { x: number; y: number };     // 肩线
  head: { x: number; y: number };         // 面罩中心
  swordHand: { x: number; y: number };    // 持剑手中心
  offHand: { x: number; y: number };
  // 腿 — front = 持剑侧腿（弓步时前伸），back = 非持剑侧
  frontHip: { x: number; y: number };
  frontKnee: { x: number; y: number };
  frontAnkle: { x: number; y: number };
  backHip: { x: number; y: number };
  backKnee: { x: number; y: number };
  backAnkle: { x: number; y: number };
  // 躯干朝向（前扑角，弧度；正 = 前扑）
  torsoLean: number;
  // 剑相对持剑手的方向（弧度，水平为 0；正 = 向上）
  swordAngle: number;
  // 有效出剑长度（米，从 swordHand 到剑尖）
  bladeLength: number;
  // 重心偏移 (-1..1，负 = 后重)
  weightShift: number;
  sideSign: number; // player 面朝 -z → sideSign = -1; AI 面朝 +z → sideSign = +1
}

function extractJoints(
  fencerSide: Side,
  pose: PoseSample,
  aim: { x: number; y: number },
  parry: number,
  weapon: Weapon,
): Joints {
  // sideSign: player 面朝 -z（poseBuffer 默认）→ -1；AI 面朝 +z → +1（需镜像 pose.z）
  const sideSign = fencerSide === 'player' ? -1 : 1;

  // === 所有坐标：pose.z → joint.x（canvas forward），pose.y → joint.y（canvas height）===
  // 镜像由 poseZ() 自动处理

  const pelvis = {
    x: poseZ(pose.pelvisPos, sideSign),
    y: poseY(pose.pelvisPos),
  };

  // torso mesh 在 motion.local
  const torsoBottom = {
    x: poseZ(pose.torsoPos, sideSign),
    y: poseY(pose.torsoPos),
  };

  // head 在 torso.local → 转回 motion.local
  const headMotion = [
    pose.torsoPos[0] + pose.headPos[0],
    pose.torsoPos[1] + pose.headPos[1],
    pose.torsoPos[2] + pose.headPos[2],
  ] as [number, number, number];
  const head = {
    x: poseZ(headMotion, sideSign),
    y: poseY(headMotion),
  };

  // swordHand 在 torso.local → 转回 motion.local
  const sHandMotion = [
    pose.torsoPos[0] + pose.swordHandTorsoLocal[0],
    pose.torsoPos[1] + pose.swordHandTorsoLocal[1],
    pose.torsoPos[2] + pose.swordHandTorsoLocal[2],
  ] as [number, number, number];
  const swordHand = {
    x: poseZ(sHandMotion, sideSign),
    y: poseY(sHandMotion),
  };

  // offHand 同理
  const oHandMotion = [
    pose.torsoPos[0] + pose.offHandTorsoLocal[0],
    pose.torsoPos[1] + pose.offHandTorsoLocal[1],
    pose.torsoPos[2] + pose.offHandTorsoLocal[2],
  ] as [number, number, number];
  const offHand = {
    x: poseZ(oHandMotion, sideSign),
    y: poseY(oHandMotion),
  };

  // === 腿链：poseBuffer 已经拼装好 root.local 坐标 ===
  // rightKneeRootLocal / rightAnkleRootLocal 是 motion.local，直接用
  // 前腿 = pose 里 z 最负（最远）的那条（朝前方伸）
  const rightAnkleZ = poseZ(pose.rightAnkleRootLocal, sideSign);
  const leftAnkleZ = poseZ(pose.leftAnkleRootLocal, sideSign);
  const rightKneeZ = poseZ(pose.rightKneeRootLocal, sideSign);
  const leftKneeZ = poseZ(pose.leftKneeRootLocal, sideSign);

  const right = {
    hip: { x: poseZ(pose.rightHipPelvisLocal, sideSign), y: poseY(pose.rightHipPelvisLocal) },
    knee: { x: rightKneeZ, y: poseY(pose.rightKneeRootLocal) },
    ankle: { x: rightAnkleZ, y: poseY(pose.rightAnkleRootLocal) },
  };
  const left = {
    hip: { x: poseZ(pose.leftHipPelvisLocal, sideSign), y: poseY(pose.leftHipPelvisLocal) },
    knee: { x: leftKneeZ, y: poseY(pose.leftKneeRootLocal) },
    ankle: { x: leftAnkleZ, y: poseY(pose.leftAnkleRootLocal) },
  };

  // 前腿 = z 更小（更朝前方）的那条
  const front = (rightAnkleZ < leftAnkleZ)
    ? { hip: right.hip, knee: right.knee, ankle: right.ankle }
    : { hip: left.hip, knee: left.knee, ankle: left.ankle };
  const back = (rightAnkleZ >= leftAnkleZ)
    ? { hip: right.hip, knee: right.knee, ankle: right.ankle }
    : { hip: left.hip, knee: left.knee, ankle: left.ankle };

  // === 躯干顶（肩线）：torsoPos + shoulder height + 前扑偏移 ===
  // torsoRot[0] = forward lean（+ = 向后仰，- = 前扑）
  // torsoRot[1] = yaw（侧转，小）
  const torsoLeanX = pose.torsoRot[0]; // 弧度，前扑角
  const torsoYaw = pose.torsoRot[1];
  const torsoTop = {
    x: poseZ(pose.torsoPos, sideSign) - Math.sin(torsoLeanX) * 0.12 + poseZ([0, 0, torsoYaw * 0.15], sideSign),
    y: poseY(pose.torsoPos) + SHOULDER_TORSO_LOCAL_Y - Math.abs(torsoLeanX) * 0.04,
  };

  // === 剑方向：aim 在屏幕空间，需要结合 sideSign ===
  // aim.x (sideSign 修正后) → 水平方向；aim.y → 垂直方向
  const bladeLen = weapon === 'sabre' ? 0.88 : 0.92;
  // 剑的基础方向（水平前方 + 微调偏移防止 atan2 奇点）
  const swordAngle = Math.atan2(-aim.y, Math.abs(aim.x * sideSign) + 0.18);

  return {
    pelvis,
    torsoBottom,
    torsoTop,
    head,
    swordHand,
    offHand,
    frontHip: front.hip,
    frontKnee: front.knee,
    frontAnkle: front.ankle,
    backHip: back.hip,
    backKnee: back.knee,
    backAnkle: back.ankle,
    torsoLean: torsoLeanX,
    swordAngle,
    bladeLength: bladeLen,
    weightShift: pose.weightShift,
    sideSign,
  };
}

// ============================================================
// FencerVisual — 2D 画剑士
// ============================================================
export class FencerVisual {
  joints!: Joints;
  private breathPhase = 0;
  weightShift = 0;
  // 缓存上一帧剑尖画 trail 用
  private lastTipLocal: { x: number; y: number } | null = null;
  trail: { x: number; y: number; life: number }[] = [];
  private viewFade = 0; // first person overlay alpha

  constructor(
    public side: Side,
    public weapon: Weapon,
  ) {
    // 初始姿态
    this.joints = extractJoints(side, enGardePose(), { x: 0, y: 0 }, 4, weapon);
  }

  update(snapshot: FencerSnapshot, dt: number, viewMode: ViewMode): void {
    const progress = actionProgress(snapshot.action);
    const pose = samplePose(snapshot.action.type, progress, snapshot.parry, snapshot.weapon);
    this.joints = extractJoints(snapshot.side, pose, snapshot.aim, snapshot.parry, snapshot.weapon);
    this.breathPhase += dt;
    this.weightShift = lerp(this.weightShift, pose.weightShift, Math.min(1, dt * 6));
    this.viewFade = lerp(this.viewFade, viewMode === 'first' ? (snapshot.side === 'player' ? 0 : 1) : 0, Math.min(1, dt * 5));
  }

  getSwordTip(): { x: number; y: number } {
    const j = this.joints;
    return {
      x: j.swordHand.x + Math.cos(j.swordAngle) * j.bladeLength * j.sideSign,
      y: j.swordHand.y - Math.sin(j.swordAngle) * j.bladeLength,
    };
  }

  dispose(): void { /* 2D 无资源 */ }
}

function actionProgress(action: FencerSnapshot['action']): number {
  if (action.duration <= 0) return 0;
  return clamp(action.elapsed / action.duration, 0, 1);
}

// ============================================================
// Scene2D — 管理画布、剑道、裁判灯、绘制循环
// ============================================================
export interface DrawTransform {
  scale: number; // 米 → 像素
  pisteCenterX: number;
  groundY: number;
  worldToCanvas: (wx: number, wy: number, wz: number) => { cx: number; cy: number };
}

export class Scene2D {
  private ctx: CanvasRenderingContext2D;
  private width = 1280;
  private height = 720;
  private lights: { player: 'off' | 'green' | 'white'; ai: 'off' | 'red' | 'white' } = { player: 'off', ai: 'off' };
  private lightsTimer = 0;
  private elapsed = 0;

  constructor(public canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas2D context unavailable');
    this.ctx = ctx;
    this.resize();
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(320, rect.width);
    this.height = Math.max(240, rect.height);
    this.canvas.width = Math.floor(this.width * dpr);
    this.canvas.height = Math.floor(this.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = true;
  }

  private computeTransform(): DrawTransform {
    // 剑道占画布宽度的 ~88%，两边留边
    const pistePx = this.width * 0.88;
    const scale = pistePx / (PISTE_HALF * 2); // 像素 / 米
    const pisteCenterX = this.width / 2;
    const groundY = this.height * 0.72; // 剑道地面在画布 72% 高度处
    return {
      scale,
      pisteCenterX,
      groundY,
      worldToCanvas: (wx, wy, wz) => ({
        cx: pisteCenterX + wz * scale,
        cy: groundY - wy * scale,
      }),
    };
  }

  setScoreLights(player: 'off' | 'green' | 'white', ai: 'off' | 'red' | 'white'): void {
    this.lights = { player, ai };
    this.lightsTimer = player !== 'off' || ai !== 'off' ? 1.8 : 0;
  }

  update(dt: number): void {
    this.elapsed += dt;
    if (this.lightsTimer > 0) this.lightsTimer -= dt;
    if (this.lightsTimer <= 0 && (this.lights.player !== 'off' || this.lights.ai !== 'off')) {
      this.lights = { player: 'off', ai: 'off' };
    }
  }

  draw(
    player: FencerVisual,
    ai: FencerVisual,
    distance: number,
    assists: boolean,
    phase: string,
    viewMode: ViewMode,
    dt: number,
  ): void {
    const ctx = this.ctx;
    const t = this.computeTransform();

    // 背景
    this.drawBackground(ctx, t);
    // 剑道
    this.drawPiste(ctx, t, this.elapsed);
    // 距离指示
    if (assists) this.drawDistanceIndicator(ctx, t, distance);

    // 裁判灯（画在剑士头顶）
    // player 在 +z → canvas 右，ai 在 -z → canvas 左
    // 但从游戏角度：player 站在己方一侧（+z），面朝 -z（对手方向）
    // 所以 player.canvas_x = pisteCenterX + player.z * scale
    // player 初始 z=2.2 → 在画布右侧；ai 初始 z=-2.2 → 在画布左侧
    // 但裁判灯：player 得分 = 他自己那侧的绿灯，画在他头顶
    // FIE 规则：两名选手头顶各有一盏灯，自己得分 → 自己头顶亮绿（player）或红（ai）
    // 但我们的实现里 player 在画布"右侧"——让我们把画布逻辑反一下：
    // 约定 player 永远在画面左侧（更直观：player 左，对手右）
    // 所以需要翻转 z 轴？或者 just swap when drawing?
    // 让我简单 swap 一下，让画面看起来自然：player 永远左，对手永远右
    // 在 FencingGame 里 player.z 初始 = +2.2，AI.z = -2.2
    // 如果我们让 canvasX = pisteCenterX - z * scale（翻转），那 player(+2.2) → center - 正 = 左
    // ai(-2.2) → center - 负 = center + 正 = 右 ✓
    // 好，那在 worldToCanvas 里我们翻转 z 的符号！
    // 但 worldToCanvas 是个闭包，我们改一下 computeTransform

    // 剑士绘制顺序：后画者在上层
    // 站位靠右的（z 更大）后画 → 在上面
    const order = (a: FencerVisual, b: FencerVisual) => {
      const sideOrder = a.side === 'player' ? 1 : 0;
      return sideOrder - (b.side === 'player' ? 1 : 0);
    };
    const [first, second] = order(player, ai) < 0 ? [player, ai] : [ai, player];

    // 更新 trail（剑尖轨迹）
    this.updateTrail(player, dt, t);
    this.updateTrail(ai, dt, t);

    // 先画后景的剑士（靠后 → z 更小 → canvas x 更靠右？不，我们刚决定翻转 z 映射）
    // 简化：固定 player 左、ai 右（不管哪个站在前面），在画的时候如果 ai 离我们更近（距离小）就让 ai 在 canvas 上稍微画大一点
    this.drawFencer(ctx, first, t, viewMode);
    this.drawFencer(ctx, second, t, viewMode);

    // 画 trail
    this.drawTrail(ctx, player, t, '#b8f34a');
    this.drawTrail(ctx, ai, t, '#ef5c4d');

    // 裁判灯（画在头顶）
    this.drawLights(ctx, player, ai, t);
  }

  private drawBackground(ctx: CanvasRenderingContext2D, _t: DrawTransform): void {
    // 深色舞台渐变
    const grad = ctx.createLinearGradient(0, 0, 0, this.height);
    grad.addColorStop(0, '#0a1114');
    grad.addColorStop(0.5, '#0e1820');
    grad.addColorStop(1, '#131c24');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.width, this.height);

    // 顶部柔光
    ctx.fillStyle = 'rgba(255,255,255,0.025)';
    ctx.fillRect(0, 0, this.width, this.height * 0.4);
  }

  private drawPiste(ctx: CanvasRenderingContext2D, t: DrawTransform, elapsed: number): void {
    const cx = t.pisteCenterX;
    const groundY = t.groundY;
    const scale = t.scale;
    // 剑道总长 14m ±2m 边界，画 ±7.5m
    const halfLen = 7.5 * scale;

    // 主地面
    ctx.fillStyle = '#c5b9a8';
    ctx.fillRect(cx - halfLen, groundY - 2, halfLen * 2, this.height - groundY + 40);

    // 木地板条纹（竖线，沿剑道方向的纹理）
    ctx.strokeStyle = 'rgba(80, 60, 40, 0.25)';
    ctx.lineWidth = 1;
    for (let i = -7.5; i <= 7.5; i += 0.25) {
      const px = cx + i * scale;
      ctx.beginPath();
      ctx.moveTo(px, groundY);
      ctx.lineTo(px, groundY + 30);
      ctx.stroke();
    }

    // 主界线（两条竖白线，剑道中央）
    const centerPulse = 0.5 + 0.5 * Math.sin(elapsed * 1.6);
    ctx.strokeStyle = `rgba(255,255,255,${0.5 + centerPulse * 0.3})`;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(cx, groundY);
    ctx.lineTo(cx, groundY + 24);
    ctx.stroke();

    // 预备线：距中心各 2m（player 起始 z=+2.2 ≈ 2m 外）
    [-2, 2].forEach((z) => {
      const px = cx - z * scale; // 用翻转后的映射（centerX - z*scale）
      ctx.strokeStyle = '#e8e1d4';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(px, groundY);
      ctx.lineTo(px, groundY + 18);
      ctx.stroke();
    });

    // 边线（两侧 14m 极限）
    ctx.strokeStyle = '#8c7d66';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - halfLen, groundY);
    ctx.lineTo(cx + halfLen, groundY);
    ctx.stroke();

    // 顶部反光
    ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.fillRect(cx - halfLen, groundY - 4, halfLen * 2, 4);
  }

  private drawDistanceIndicator(ctx: CanvasRenderingContext2D, t: DrawTransform, distance: number): void {
    // 一条竖线标记两人间距离，画在画布顶部中央
    const halfLen = 7.5 * t.scale;
    const cx = t.pisteCenterX;
    const y = this.height * 0.08;

    // 标尺
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - halfLen, y);
    ctx.lineTo(cx + halfLen, y);
    ctx.stroke();

    // 刻度
    for (let d = -7; d <= 7; d++) {
      ctx.strokeStyle = d === 0 ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.1)';
      ctx.lineWidth = d === 0 ? 2 : 1;
      const px = cx - d * t.scale;
      ctx.beginPath();
      ctx.moveTo(px, y - 4);
      ctx.lineTo(px, y + 4);
      ctx.stroke();
    }

    // 危险区（弓步距离 ±1.5m）
    ctx.fillStyle = 'rgba(239, 92, 77, 0.18)';
    ctx.fillRect(cx - 1.5 * t.scale, y - 14, 3 * t.scale, 28);

    // 威胁区（±2.5m）
    ctx.fillStyle = 'rgba(243, 187, 74, 0.12)';
    ctx.fillRect(cx - 2.5 * t.scale, y - 10, 5 * t.scale, 20);
  }

  private updateTrail(fencer: FencerVisual, dt: number, _t: DrawTransform): void {
    // 根据动作类型决定是否加 trail 点
    const action = (fencer as unknown as { _action?: ActionType })._action;
    void action; // trail 简化处理
    // 每帧都存一个点（短 trail，12 帧以内）
    const tip = fencer.getSwordTip();
    fencer.trail.push({ x: tip.x, y: tip.y, life: 0.35 });
    for (const p of fencer.trail) p.life -= dt;
    fencer.trail = fencer.trail.filter((p) => p.life > 0).slice(-18);
  }

  private drawTrail(ctx: CanvasRenderingContext2D, fencer: FencerVisual, _t: DrawTransform, color: string): void {
    if (fencer.trail.length < 2) return;
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 1; i < fencer.trail.length; i++) {
      const p0 = fencer.trail[i - 1];
      const p1 = fencer.trail[i];
      const alpha = p1.life / 0.35;
      ctx.globalAlpha = alpha * 0.4;
      ctx.lineWidth = 2 + alpha * 2;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  private drawLights(ctx: CanvasRenderingContext2D, player: FencerVisual, ai: FencerVisual, t: DrawTransform): void {
    // 世界 y 头位置 → canvas y（翻转）
    void t;
    const lights = this.lights;
    const drawSingle = (f: FencerVisual, light: 'off' | 'green' | 'white' | 'red') => {
      if (light === 'off') return;
      const j = f.joints;
      const cx = this.computeTransform();
      const tip = f.getSwordTip();
      // head world → canvas：我们在 drawFencer 里用的翻转映射
      // 复用 worldToCanvas：cx.wt(x, y, z) = { cx: cx.pisteCenterX - z * cx.scale, cy: groundY - y * cx.scale }
      // 但 head 的 world position 是 (pose.head.x, pose.head.y, fencer.z)
      // 这里 fencer.z 没有直接存，让我用 pose.world → canvas 的换算
      // 简单算：head 在 canvas 的 y = groundY - head.y * scale
      const headYCanvas = cx.groundY - j.head.y * cx.scale;
      const headXCanvas = cx.pisteCenterX; // 简化：画在中心偏上的位置，实际上裁判灯在 HUD 里单独有显示
      // 我们把灯画在剑士头顶 ~30px
      const px = headXCanvas;
      const py = headYCanvas - 26;
      // 实际上裁判灯在当前版本主要由 HUD 的 DOM 显示，这里只画简化的小灯指示
      // 但为了对齐 FencingGame.ts 里 setScoreLights 的语义（player 灯 → player 得分）
      // player 站在 +z → canvas 左（翻转后 centerX - z*scale），AI 站在 -z → canvas 右
      // 所以把 player 灯画在中心偏左，AI 灯画在偏右
      // 但其实 HUD 已经有完整的裁判灯 DOM，2D canvas 里不需要重复画
      // 这里留空，避免和 HUD 重复 — 保持接口一致性即可
      void px; void py; void tip;
    };
    drawSingle(player, lights.player);
    drawSingle(ai, lights.ai);
  }

  private drawFencer(ctx: CanvasRenderingContext2D, fencer: FencerVisual, _t: DrawTransform, viewMode: ViewMode): void {
    const cx = this.computeTransform();
    const j = fencer.joints;
    const scale = cx.scale;
    const groundY = cx.groundY;
    const canvasCenterX = cx.pisteCenterX;

    // fencer world z → canvas base x（翻转 z 映射：player 左，AI 右）
    const worldZ = (fencer as unknown as { _z?: number })._z ?? (fencer.side === 'player' ? 2.2 : -2.2);
    const canvasXBase = canvasCenterX - worldZ * scale;

    // === world-local joint → canvas ===
    // joint.x = pose.z 镜像后 = world-local forward offset
    // joint.y = pose.y = world-local height
    const toCanvas = (jx: number, jy: number) => ({
      x: canvasXBase - jx * scale,
      y: groundY - jy * scale,
    });

    const pelvis  = toCanvas(j.pelvis.x, j.pelvis.y);
    const tTop    = toCanvas(j.torsoTop.x, j.torsoTop.y);
    const tBot    = toCanvas(j.torsoBottom.x, j.torsoBottom.y);
    const head    = toCanvas(j.head.x, j.head.y);
    const sHand   = toCanvas(j.swordHand.x, j.swordHand.y);
    const oHand   = toCanvas(j.offHand.x, j.offHand.y);
    const fHip    = toCanvas(j.frontHip.x, j.frontHip.y);
    const fKnee   = toCanvas(j.frontKnee.x, j.frontKnee.y);
    const fAnk    = toCanvas(j.frontAnkle.x, j.frontAnkle.y);
    const bHip    = toCanvas(j.backHip.x, j.backHip.y);
    const bKnee   = toCanvas(j.backKnee.x, j.backKnee.y);
    const bAnk    = toCanvas(j.backAnkle.x, j.backAnkle.y);

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // --- 腿 ---
    const drawLeg = (hip: { x: number; y: number }, knee: { x: number; y: number }, ankle: { x: number; y: number }, color: string, width: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(hip.x, hip.y);
      ctx.lineTo(knee.x, knee.y);
      ctx.lineTo(ankle.x, ankle.y);
      ctx.stroke();
    };
    // 背腿（先画，较细）
    drawLeg(bHip, bKnee, bAnk, '#8c8c8c', 6);
    // 前腿（后画，较粗）
    drawLeg(fHip, fKnee, fAnk, '#e8e0d4', 10);

    // --- 躯干（击剑服夹克）---
    // 肩宽 ≈ 0.30m，腰宽 ≈ 0.22m
    const shoulderHalf = 0.15 * scale;
    const waistHalf = 0.11 * scale;
    // 躯干 lean 让肩线随前扑偏移
    const leanForward = -Math.sin(j.torsoLean) * 0.04 * scale; // 前扑时肩上提前伸
    const tTopLeft  = { x: tTop.x - shoulderHalf + leanForward, y: tTop.y };
    const tTopRight = { x: tTop.x + shoulderHalf + leanForward, y: tTop.y };
    const tBotLeft  = { x: tBot.x - waistHalf, y: tBot.y };
    const tBotRight = { x: tBot.x + waistHalf, y: tBot.y };
    ctx.fillStyle = '#f4f0e8';
    ctx.beginPath();
    ctx.moveTo(tTopLeft.x, tTopLeft.y);
    ctx.lineTo(tTopRight.x, tTopRight.y);
    ctx.lineTo(tBotRight.x, tBotRight.y);
    ctx.lineTo(tBotLeft.x, tBotLeft.y);
    ctx.closePath();
    ctx.fill();

    // 夹克下摆阴影 + 后背中线
    ctx.strokeStyle = 'rgba(30,30,30,0.25)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(tBotLeft.x, tBotLeft.y);
    ctx.lineTo(tBotRight.x, tBotRight.y);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(tTop.x, tTop.y + 3);
    ctx.lineTo(tBot.x, tBot.y);
    ctx.stroke();

    // --- 头部 ---
    const headRadius = 0.09 * scale;
    const headLeanForward = leanForward * 0.8;
    const headCx = head.x + headLeanForward;
    const headCy = head.y;
    // 面罩（暗色金属壳）
    ctx.fillStyle = '#2a2f34';
    ctx.beginPath();
    ctx.arc(headCx, headCy, headRadius, 0, Math.PI * 2);
    ctx.fill();
    // 面罩网格（水平线）
    ctx.strokeStyle = '#9aa4ad';
    ctx.lineWidth = 1.2;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(headCx - headRadius * 0.85, headCy + i * headRadius * 0.28);
      ctx.lineTo(headCx + headRadius * 0.85, headCy + i * headRadius * 0.28);
      ctx.stroke();
    }
    // 面罩钢环边框
    ctx.strokeStyle = '#c8ccd0';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(headCx, headCy, headRadius + 2, 0, Math.PI * 2);
    ctx.stroke();
    // 护颈 bib（面罩下方小布罩）
    ctx.fillStyle = '#d8d4cc';
    ctx.beginPath();
    ctx.moveTo(headCx - headRadius * 0.55, headCy + headRadius - 2);
    ctx.lineTo(headCx - headRadius * 0.25, headCy + headRadius + headRadius * 1.1);
    ctx.lineTo(headCx + headRadius * 0.25, headCy + headRadius + headRadius * 1.1);
    ctx.lineTo(headCx + headRadius * 0.55, headCy + headRadius - 2);
    ctx.closePath();
    ctx.fill();

    // --- 手臂 ---
    // 肩线位置（从 tTop 沿 lean 向前后延伸）
    const sShoulderX = tTop.x + j.sideSign * shoulderHalf + leanForward; // 持剑侧：sideSign 决定哪只手在前
    const sShoulderY = tTop.y + 3;
    const oShoulderX = tTop.x - j.sideSign * shoulderHalf + leanForward;
    const oShoulderY = tTop.y + 3;

    // 非持剑手（画在持剑手下层）
    ctx.strokeStyle = '#f4f0e8';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(oShoulderX, oShoulderY);
    ctx.lineTo(oHand.x, oHand.y);
    ctx.stroke();
    ctx.fillStyle = '#f4f0e8';
    ctx.beginPath();
    ctx.arc(oHand.x, oHand.y, 0.055 * scale, 0, Math.PI * 2);
    ctx.fill();

    // 持剑手
    ctx.strokeStyle = '#f4f0e8';
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(sShoulderX, sShoulderY);
    ctx.lineTo(sHand.x, sHand.y);
    ctx.stroke();

    // --- 剑 ---
    const forwardSign = -j.sideSign; // player 面朝 -z → -(-1)=+1（画布 forward 是 +x 方向）
    const swordTip = {
      x: sHand.x + Math.cos(j.swordAngle) * j.bladeLength * scale * forwardSign,
      y: sHand.y - Math.sin(j.swordAngle) * j.bladeLength * scale,
    };
    const gripBack = {
      x: sHand.x - Math.cos(j.swordAngle) * 0.06 * scale * forwardSign,
      y: sHand.y + Math.sin(j.swordAngle) * 0.06 * scale,
    };
    // 护手（钟形 / 十字）
    const guardSize = 0.05 * scale;
    const guardNormX = -Math.sin(j.swordAngle) * forwardSign;
    const guardNormY = -Math.cos(j.swordAngle);
    ctx.strokeStyle = '#d1c5a3';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(sHand.x + guardNormX * guardSize, sHand.y + guardNormY * guardSize);
    ctx.lineTo(sHand.x - guardNormX * guardSize, sHand.y - guardNormY * guardSize);
    ctx.stroke();

    // 剑身（细白）
    ctx.strokeStyle = '#e0e8ed';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sHand.x + Math.cos(j.swordAngle) * 0.03 * scale * forwardSign, sHand.y - Math.sin(j.swordAngle) * 0.03 * scale);
    ctx.lineTo(swordTip.x, swordTip.y);
    ctx.stroke();

    // 握柄
    ctx.strokeStyle = '#4a3c2a';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(sHand.x, sHand.y);
    ctx.lineTo(gripBack.x, gripBack.y);
    ctx.stroke();

    // 持剑手套
    ctx.fillStyle = fencer.weapon === 'sabre' ? '#d4d0c8' : '#f4f0e8';
    ctx.beginPath();
    ctx.arc(sHand.x, sHand.y, 0.065 * scale, 0, Math.PI * 2);
    ctx.fill();

    // 重心偏移点（调试视觉）
    if (fencer.weightShift !== 0) {
      ctx.fillStyle = '#ef5c4d';
      ctx.beginPath();
      ctx.arc(pelvis.x + fencer.weightShift * 0.04 * scale, pelvis.y + 0.12 * scale, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    void viewMode;
  }

  dispose(): void {
    this.canvas.remove();
  }
}
