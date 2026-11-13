import * as THREE from 'three';
import { Arena, FencerVisual } from './visuals';
import { FencingAudio } from './audio';
import { PARRY_NAMES, WEAPON_INFO } from './types';
import type { ActionState, AIStyle, CombatEvent, Difficulty, FencerSnapshot, GamePhase, MatchConfig, Side, ViewMode, Weapon } from './types';

export interface GameSnapshot {
  phase: GamePhase;
  score: { player: number; ai: number };
  time: number;
  distance: number;
  zone: '安全距离' | '威胁距离' | '弓步距离' | '内围距离';
  priority: Side | null;
  view: ViewMode;
  playerAction: string;
  aiAction: string;
  parry: number;
  stats: { hits: number; parries: number; attacks: number };
  overtime: boolean;
}

interface Fencer {
  side: Side;
  position: THREE.Vector3;
  aim: { x: number; y: number };
  action: ActionState;
  bladeBase: THREE.Vector3;
  bladeTip: THREE.Vector3;
  previousTip: THREE.Vector3;
  visual: FencerVisual;
  parry: number;
  extension: number;
  lastParry: number;
  lastAttackEnd: number;
  lastAimX: number;
  speed: number;
  thinkIn: number;
  moveDirection: number;
  stats: { hits: number; parries: number; attacks: number };
}

interface PendingHit { side: Side; at: number; target: string }
interface BodyTarget { center: THREE.Vector3; radius: number; name: string; region: 'torso' | 'head' | 'arm' | 'leg' }

const idleAction = (): ActionState => ({ type: 'idle', elapsed: 0, duration: 0, hitAt: 0, hasHit: false });
const clamp = THREE.MathUtils.clamp;
const easeOut = (t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const easeInOut = (t: number) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const ACTION_NAMES: Record<string, string> = {
  idle: 'En garde · 预备', advance: 'Advance · 向前步', retreat: 'Retreat · 向后步',
  halfstep: 'Half-step · 半步', glissade: 'Glissade · 滑步', lunge: 'Lunge · 弓步直刺',
  fleche: 'Flèche · 冲刺进攻', ballestra: 'Ballestra · 跃步', attack: 'Straight Thrust · 直刺',
  feint: 'Feint · 佯攻', parry: 'Parry · 格挡', prise: 'Prise de fer · 压剑', hit: 'Touché · 命中',
};

export class FencingGame {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(54, 1, 0.045, 90);
  readonly audio = new FencingAudio();
  config: MatchConfig = { weapon: 'foil', style: 'counter', difficulty: 'advanced', assists: true, targetScore: 15 };
  phase: GamePhase = 'menu';
  view: ViewMode = 'third';

  private arena: Arena;
  private player: Fencer;
  private ai: Fencer;
  private previousPhase: GamePhase = 'allez';
  private phaseElapsed = 0;
  private phaseDuration = 0;
  private elapsed = 0;
  private matchTime = 180;
  private overtime = false;
  private score = { player: 0, ai: 0 };
  private priority: Side | null = null;
  private pendingHits: PendingHit[] = [];
  private keys = new Set<string>();
  private clock = new THREE.Clock();
  private animationFrame = 0;
  private viewBlend = 0;
  private uiElapsed = 0;
  private accumulator = 0;
  private pointerWasLocked = false;
  private destroyed = false;
  private trails: Record<Side, THREE.Line>;
  private trailPoints: Record<Side, THREE.Vector3[]> = { player: [], ai: [] };
  private clashLight = new THREE.PointLight('#d9f8ff', 0, 3);
  private resumeAfterPointer = false;

  constructor(
    private container: HTMLElement,
    private onEvent: (event: CombatEvent) => void,
    private onUpdate: (snapshot: GameSnapshot) => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.id = 'fencing-canvas';
    this.renderer.domElement.tabIndex = 0;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color('#080d0f');
    this.scene.fog = new THREE.FogExp2('#080d0f', 0.037);
    this.arena = new Arena(this.scene);
    this.scene.add(this.clashLight);
    this.player = this.createFencer('player');
    this.ai = this.createFencer('ai');
    this.trails = { player: this.createTrail('#b8f34a'), ai: this.createTrail('#ef5c4d') };
    this.resetPositions();
    this.bindInput();
    this.resize();
    window.addEventListener('resize', this.resize);
    this.clock.start();
    this.loop();
  }

  private createFencer(side: Side): Fencer {
    const fencer: Fencer = {
      side,
      position: new THREE.Vector3(0, 0, side === 'player' ? 2.2 : -2.2),
      aim: { x: 0, y: 0 }, action: idleAction(),
      bladeBase: new THREE.Vector3(), bladeTip: new THREE.Vector3(), previousTip: new THREE.Vector3(),
      visual: new FencerVisual(this.scene, side, this.config.weapon), parry: 4, extension: 0.12,
      lastParry: -10, lastAttackEnd: -10, lastAimX: 0, speed: 0, thinkIn: 0.4, moveDirection: 0,
      stats: { hits: 0, parries: 0, attacks: 0 },
    };
    this.calculateBlade(fencer);
    fencer.previousTip.copy(fencer.bladeTip);
    return fencer;
  }

  private createTrail(color: string) {
    const geometry = new THREE.BufferGeometry();
    const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.28, depthWrite: false });
    const line = new THREE.Line(geometry, material);
    line.frustumCulled = false;
    this.scene.add(line);
    return line;
  }

  previewConfig(config: MatchConfig) {
    const weaponChanged = config.weapon !== this.config.weapon;
    this.config = { ...config };
    if (weaponChanged) {
      this.player.visual.dispose();
      this.ai.visual.dispose();
      this.scene.remove(this.player.visual.group, this.ai.visual.group);
      this.player.visual = new FencerVisual(this.scene, 'player', config.weapon);
      this.ai.visual = new FencerVisual(this.scene, 'ai', config.weapon);
    }
  }

  startMatch(config: MatchConfig) {
    this.previewConfig(config);
    this.score = { player: 0, ai: 0 };
    this.matchTime = 180;
    this.overtime = false;
    this.elapsed = 0;
    this.player.stats = { hits: 0, parries: 0, attacks: 0 };
    this.ai.stats = { hits: 0, parries: 0, attacks: 0 };
    this.priority = null;
    this.pendingHits = [];
    this.viewBlend = this.view === 'first' ? 1 : 0;
    this.resetPositions();
    this.beginPhase('en garde', 1.45);
    this.emit('phase', undefined, 'En garde', '双方进入预备线');
    this.audio.command();
    this.requestPointer();
  }

  restart() { this.startMatch(this.config); }

  pause() {
    if (!['allez', 'en garde', 'ready', 'halt'].includes(this.phase)) return;
    this.previousPhase = this.phase;
    this.phase = 'pause';
    this.keys.clear();
    if (document.pointerLockElement) document.exitPointerLock();
    this.emit('phase', undefined, '比赛暂停', 'Halt');
  }

  resume() {
    if (this.phase !== 'pause') return;
    this.phase = this.previousPhase;
    this.clock.getDelta();
    this.requestPointer();
    this.emit('phase', undefined, this.phase === 'allez' ? 'Allez' : '继续', '比赛恢复');
  }

  toMenu() {
    this.phase = 'menu';
    this.keys.clear();
    this.priority = null;
    this.pendingHits = [];
    this.resetPositions();
    this.arena.setScoreLights('off', 'off');
    if (document.pointerLockElement) document.exitPointerLock();
  }

  toggleView() {
    this.view = this.view === 'third' ? 'first' : 'third';
    this.emit('action', undefined, this.view === 'first' ? '第一人称 · 面罩视野' : '第三人称 · 战术视野', '动作状态保持');
  }

  requestPointer() {
    if (this.phase === 'menu' || this.phase === 'end') return;
    this.resumeAfterPointer = true;
    try {
      const request = this.renderer.domElement.requestPointerLock();
      if (request && typeof request.catch === 'function') request.catch(() => { this.resumeAfterPointer = false; });
    } catch { this.resumeAfterPointer = false; }
  }

  private bindInput() {
    window.addEventListener('keydown', (event) => {
      if (['Space', 'ArrowUp', 'ArrowDown'].includes(event.code)) event.preventDefault();
      if (event.code === 'Escape') {
        if (this.phase === 'pause') this.resume(); else this.pause();
        return;
      }
      if (event.code === 'KeyQ' && !event.repeat && this.phase !== 'menu' && this.phase !== 'end') this.toggleView();
      if (this.phase !== 'allez' || event.repeat) { this.keys.add(event.code); return; }
      this.keys.add(event.code);
      if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') this.startAttack(this.player, 'lunge');
      if (event.code === 'KeyF') this.startAttack(this.player, 'fleche');
      if (event.code === 'Space') this.startBallestra(this.player);
      if (event.code === 'KeyC') this.startHalfstep(this.player);
      if (event.code === 'KeyG') this.startFeint(this.player);
      if (event.code === 'KeyE') this.startPrise(this.player);
      if (/^Digit[1-8]$/.test(event.code)) {
        this.player.parry = Number(event.code.slice(-1));
        this.setAimForParry(this.player, this.player.parry);
      }
    });
    window.addEventListener('keyup', (event) => this.keys.delete(event.code));
    window.addEventListener('blur', () => { if (this.phase === 'allez') this.pause(); });
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === this.renderer.domElement;
      if (locked) { this.pointerWasLocked = true; this.resumeAfterPointer = false; }
      else if (this.pointerWasLocked && this.phase === 'allez' && !this.resumeAfterPointer) this.pause();
      if (!locked) this.pointerWasLocked = false;
    });
    document.addEventListener('mousemove', (event) => {
      if (this.phase !== 'allez') return;
      if (document.pointerLockElement === this.renderer.domElement) {
        this.player.aim.x = clamp(this.player.aim.x + event.movementX * 0.0021, -1, 1);
        this.player.aim.y = clamp(this.player.aim.y - event.movementY * 0.0021, -0.9, 1);
      } else {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.player.aim.x = clamp(((event.clientX - rect.left) / rect.width - 0.5) * 2.2, -1, 1);
        this.player.aim.y = clamp((0.5 - (event.clientY - rect.top) / rect.height) * 2.2, -0.9, 1);
      }
      if (this.player.action.type !== 'parry') this.player.parry = this.parryFromAim(this.player.aim.x, this.player.aim.y);
    });
    this.renderer.domElement.addEventListener('mousedown', (event) => {
      if (this.phase !== 'allez') return;
      if (!document.pointerLockElement) this.requestPointer();
      if (event.button === 0) this.startAttack(this.player, 'attack');
      if (event.button === 2) this.startParry(this.player);
      if (event.button === 1) this.startFeint(this.player);
    });
    this.renderer.domElement.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  private resize = () => {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  };

  private resetPositions() {
    for (const fencer of [this.player, this.ai]) {
      fencer.position.set(0, 0, fencer.side === 'player' ? 2.2 : -2.2);
      fencer.aim = { x: 0, y: 0 };
      fencer.action = idleAction();
      fencer.parry = 4;
      fencer.extension = 0.12;
      fencer.lastParry = -10;
      fencer.lastAttackEnd = -10;
      fencer.speed = 0;
      fencer.moveDirection = 0;
      fencer.thinkIn = 0.35;
      this.calculateBlade(fencer);
      fencer.previousTip.copy(fencer.bladeTip);
      this.trailPoints[fencer.side] = [];
    }
    this.pendingHits = [];
    this.arena.setScoreLights('off', 'off');
  }

  private beginPhase(phase: GamePhase, duration: number) {
    this.phase = phase;
    this.phaseElapsed = 0;
    this.phaseDuration = duration;
  }

  private emit(type: CombatEvent['type'], side: Side | undefined, title: string, detail = '', valid?: boolean) {
    this.onEvent({ type, side, title, detail, valid, score: { ...this.score } });
  }

  private isAttacking(fencer: Fencer) {
    return ['attack', 'lunge', 'fleche'].includes(fencer.action.type);
  }

  private canAct(fencer: Fencer) {
    return ['idle', 'advance', 'retreat', 'glissade'].includes(fencer.action.type);
  }

  private startHalfstep(fencer: Fencer) {
    if (!this.canAct(fencer)) return;
    const backward = fencer.side === 'player' && this.keys.has('KeyS');
    fencer.action = { ...idleAction(), type: 'halfstep', duration: 0.2 };
    fencer.moveDirection = backward ? -1 : 1;
    this.audio.step();
  }

  private startBallestra(fencer: Fencer) {
    if (!this.canAct(fencer)) return;
    fencer.action = { ...idleAction(), type: 'ballestra', duration: 0.46 };
    fencer.moveDirection = 1;
    this.audio.step();
    this.emit('action', fencer.side, 'Ballestra', '跃步 · 可衔接弓步');
  }

  private startFeint(fencer: Fencer) {
    if (!this.canAct(fencer)) return;
    fencer.action = { ...idleAction(), type: 'feint', duration: 0.48, startAimX: fencer.aim.x, startAimY: fencer.aim.y, isFeint: true };
    if (this.config.weapon !== 'epee' && !this.priority) this.setPriority(fencer.side);
    this.audio.swish();
    this.emit('action', fencer.side, 'Feint', '佯攻 · 左键衔接转移进攻');
  }

  private startPrise(fencer: Fencer) {
    if (!this.canAct(fencer)) return;
    const opponent = this.opponent(fencer);
    const bladeDistance = this.segmentDistance(fencer.bladeBase, fencer.bladeTip, opponent.bladeBase, opponent.bladeTip);
    if (bladeDistance > 0.38 || this.bodyDistance() > 2.5) {
      this.emit('blade', fencer.side, 'Prise de fer · 未贴剑', '靠近并让双方剑刃接触');
      fencer.action = { ...idleAction(), type: 'parry', duration: 0.28, parry: fencer.parry };
      return;
    }
    fencer.action = { ...idleAction(), type: 'prise', duration: 0.58 };
    opponent.aim.x += fencer.side === 'player' ? 0.4 : -0.4;
    this.audio.blade();
    this.emit('blade', fencer.side, 'Prise de fer', 'Croisé · 剑刃控制成功，左键进攻');
  }

  private startParry(fencer: Fencer, forcedParry?: number) {
    if (!this.canAct(fencer) && fencer.action.type !== 'feint') return;
    const parry = forcedParry ?? this.parryFromAim(fencer.aim.x, fencer.aim.y);
    fencer.parry = parry;
    this.setAimForParry(fencer, parry);
    fencer.action = { ...idleAction(), type: 'parry', duration: 0.43, parry };
    this.emit('action', fencer.side, `Parry ${parry}`, PARRY_NAMES[parry - 1]);
  }

  private startAttack(fencer: Fencer, kind: 'attack' | 'lunge' | 'fleche') {
    const current = fencer.action;
    const canChainFeint = current.type === 'feint' && current.elapsed > 0.1;
    const canChainPrise = current.type === 'prise';
    const canChainBallestra = current.type === 'ballestra' && current.elapsed > 0.2;
    const recovery = this.isAttacking(fencer) && current.elapsed > current.hitAt + 0.16 && current.elapsed < current.duration;
    if (!this.canAct(fencer) && !canChainFeint && !canChainPrise && !canChainBallestra && !recovery) return;
    if (kind === 'fleche' && current.type !== 'idle' && !this.canAct(fencer)) return;

    const sinceParry = this.elapsed - fencer.lastParry;
    const isRiposte = sinceParry < 1.05;
    const isRemise = recovery || this.elapsed - fencer.lastAttackEnd < 0.24;
    const disengaged = canChainFeint || Math.abs(fencer.aim.x - fencer.lastAimX) > 0.45;
    const duration = kind === 'lunge' ? 0.92 : kind === 'fleche' ? 1.04 : isRiposte ? 0.56 : 0.68;
    const hitAt = kind === 'lunge' ? 0.22 : kind === 'fleche' ? 0.28 : isRiposte ? 0.13 : 0.17;
    fencer.action = {
      type: kind, elapsed: 0, duration, hitAt, hasHit: false,
      attackLine: this.parryFromAim(fencer.aim.x, fencer.aim.y), startAimX: fencer.aim.x, startAimY: fencer.aim.y,
      disengaged, isRiposte, isRemise, owner: fencer.side,
    };
    fencer.lastAimX = fencer.aim.x;
    fencer.stats.attacks++;
    fencer.moveDirection = 1;
    if (this.config.weapon !== 'epee' && !this.priority) this.setPriority(fencer.side);
    this.audio.swish();
    if (kind === 'lunge' || kind === 'fleche') this.audio.step();

    let title = kind === 'lunge' ? 'Lunge' : kind === 'fleche' ? 'Flèche' : this.config.weapon === 'sabre' ? 'Cut · 劈砍' : 'Straight Thrust';
    let detail = kind === 'attack' ? 'Simple Attack · 简单进攻' : '原始进攻';
    if (isRiposte) {
      title = disengaged ? 'Disengagement Riposte' : sinceParry > 0.34 ? 'Delayed Riposte' : 'Direct Riposte';
      detail = disengaged ? '转移反击' : sinceParry > 0.34 ? '延迟反击' : '直接反击';
    } else if (disengaged) { title = 'Disengagement'; detail = 'Compound Attack · 转移进攻'; }
    else if (isRemise) { title = 'Remise'; detail = '延续进攻'; }
    this.emit('action', fencer.side, title, detail);
  }

  private setPriority(side: Side | null) {
    if (this.priority === side) return;
    this.priority = side;
    if (side) this.emit('priority', side, 'Right of Way', `${side === 'player' ? '你' : '对手'}持有优先权`);
  }

  private setAimForParry(fencer: Fencer, parry: number) {
    const aims: Record<number, [number, number]> = {
      1: [-0.85, -0.65], 2: [0.85, -0.65], 3: [0.52, 0], 4: [-0.3, 0],
      5: [0.62, 0.72], 6: [-0.45, 0.72], 7: [-0.2, -0.65], 8: [0.2, -0.65],
    };
    const [x, y] = aims[parry];
    fencer.aim.x = x;
    fencer.aim.y = y;
  }

  private parryFromAim(x: number, y: number) {
    if (y > 0.34) return x < 0 ? 6 : 5;
    if (y < -0.34) {
      if (x < -0.45) return 1;
      if (x < 0) return 7;
      if (x < 0.45) return 8;
      return 2;
    }
    return x < 0 ? 4 : 3;
  }

  private opponent(fencer: Fencer) { return fencer.side === 'player' ? this.ai : this.player; }
  private bodyDistance() { return Math.abs(this.player.position.z - this.ai.position.z); }

  private move(fencer: Fencer, direction: number, amount: number) {
    if (!direction || !amount) return;
    const sign = fencer.side === 'player' ? -1 : 1;
    fencer.position.z += sign * direction * amount;
    fencer.position.z = clamp(fencer.position.z, -6.65, 6.65);
    const distance = this.bodyDistance();
    if (distance < 0.64) {
      const midpoint = (this.player.position.z + this.ai.position.z) / 2;
      this.player.position.z = midpoint + 0.32;
      this.ai.position.z = midpoint - 0.32;
    }
  }

  private updatePlayer(dt: number) {
    const fencer = this.player;
    if (!this.canAct(fencer)) return;
    let direction = 0;
    if (this.keys.has('KeyW')) direction += 1;
    if (this.keys.has('KeyS')) direction -= 1;
    if (this.keys.has('KeyV')) direction = 1;
    const lateral = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    fencer.position.x = clamp(fencer.position.x + lateral * dt * 0.42, -0.55, 0.55);
    if (this.keys.has('KeyV')) {
      fencer.action.type = 'glissade';
      this.move(fencer, direction, dt * 0.86);
    } else if (direction) {
      const nextType = direction > 0 ? 'advance' : 'retreat';
      if (fencer.action.type !== nextType) this.audio.step();
      fencer.action.type = nextType;
      fencer.moveDirection = direction;
      this.move(fencer, direction, dt * 1.32);
    } else if (['advance', 'retreat', 'glissade'].includes(fencer.action.type)) {
      fencer.action = idleAction();
    }
  }

  private aiParameters() {
    const difficulty: Record<Difficulty, { reaction: number; parry: number; speed: number }> = {
      rookie: { reaction: 0.48, parry: 0.32, speed: 0.83 },
      advanced: { reaction: 0.3, parry: 0.54, speed: 0.97 },
      master: { reaction: 0.18, parry: 0.72, speed: 1.08 },
    };
    return difficulty[this.config.difficulty];
  }

  private updateAI(dt: number) {
    const ai = this.ai;
    const player = this.player;
    const params = this.aiParameters();
    ai.thinkIn -= dt;
    if (ai.action.type === 'feint' && ai.action.elapsed > 0.24) {
      ai.aim.x = player.action.type === 'parry' ? -player.aim.x : (Math.random() > 0.5 ? 0.45 : -0.4);
      ai.lastAimX = -ai.aim.x;
      this.startAttack(ai, this.bodyDistance() > 1.9 ? 'lunge' : 'attack');
      return;
    }
    if (ai.thinkIn > 0) return;
    ai.thinkIn = params.reaction * (0.8 + Math.random() * 0.45);
    const distance = this.bodyDistance();
    const playerThreat = this.isAttacking(player) && player.action.elapsed < player.action.hitAt + 0.13 && distance < 3.15;
    const playerOpen = (this.isAttacking(player) && player.action.elapsed > player.action.hitAt + 0.18) || player.action.type === 'ballestra';

    if (playerThreat && this.canAct(ai)) {
      const counterBonus = this.config.style === 'counter' ? 0.17 : 0;
      if (Math.random() < params.parry + counterBonus) {
        const correct = Math.random() < (this.config.difficulty === 'rookie' ? 0.64 : 0.86);
        const line = player.action.attackLine ?? 4;
        this.startParry(ai, correct ? line : (line % 8) + 1);
      } else {
        ai.action = { ...idleAction(), type: 'retreat', duration: params.reaction };
        this.move(ai, -1, 0.2);
      }
      return;
    }
    if (!this.canAct(ai)) return;

    if (this.elapsed - ai.lastParry < 0.82 && distance < 2.3) {
      this.startAttack(ai, 'attack');
      return;
    }
    if (playerOpen && distance < 3.15) {
      this.startAttack(ai, distance > 1.9 ? 'lunge' : 'attack');
      return;
    }

    const roll = Math.random();
    if (this.config.style === 'aggressive') {
      if (distance < 3.55 && roll < 0.42) this.startAttack(ai, distance > 2.6 ? 'fleche' : distance > 1.8 ? 'lunge' : 'attack');
      else this.aiMove(distance > 2.25 ? 1 : -1, params.speed);
    } else if (this.config.style === 'deceiver') {
      if (distance < 2.75 && roll < 0.48) this.startFeint(ai);
      else if (distance < 2.25 && roll < 0.68) this.startAttack(ai, 'lunge');
      else this.aiMove(distance > 2.2 ? 1 : distance < 1.45 ? -1 : 0, params.speed);
    } else {
      if (distance < 1.9 && roll < 0.26) this.startAttack(ai, 'attack');
      else if (distance < 2.55 && roll < 0.38) this.startFeint(ai);
      else this.aiMove(distance > 2.45 ? 1 : distance < 1.5 ? -1 : roll < 0.2 ? -1 : 0, params.speed);
    }
  }

  private aiMove(direction: number, speed: number) {
    if (!direction) { this.ai.action = idleAction(); return; }
    this.ai.action = { ...idleAction(), type: direction > 0 ? 'advance' : 'retreat', duration: this.ai.thinkIn + 0.08 };
    this.ai.moveDirection = direction;
    this.move(this.ai, direction, 0.12 * speed);
  }

  private updateAction(fencer: Fencer, dt: number) {
    const action = fencer.action;
    action.elapsed += dt;
    const t = action.elapsed;
    if (action.type === 'halfstep') this.move(fencer, fencer.moveDirection, dt * 0.82);
    if (action.type === 'ballestra' && t < 0.3) this.move(fencer, 1, dt * 2.25);
    if (action.type === 'lunge' && t > 0.07 && t < 0.43) this.move(fencer, 1, dt * 2.75 * Math.sin(((t - 0.07) / 0.36) * Math.PI));
    if (action.type === 'fleche' && t > 0.08 && t < 0.59) this.move(fencer, 1, dt * 4.15 * Math.sin(((t - 0.08) / 0.51) * Math.PI));

    if (this.isAttacking(fencer)) {
      if (t < action.hitAt) fencer.extension = 0.12 + 0.88 * easeOut(t / action.hitAt);
      else if (t < action.hitAt + 0.19) fencer.extension = 1;
      else fencer.extension = 1 - 0.88 * easeInOut((t - action.hitAt - 0.19) / Math.max(0.1, action.duration - action.hitAt - 0.19));
      if (t > action.hitAt * 0.45 && !action.disengaged && Math.abs(fencer.aim.x - (action.startAimX ?? 0)) > 0.38) {
        action.disengaged = true;
        action.attackLine = this.parryFromAim(fencer.aim.x, fencer.aim.y);
      }
    } else if (action.type === 'feint') {
      fencer.extension = 0.12 + 0.55 * Math.sin(clamp(t / action.duration, 0, 1) * Math.PI);
    } else if (action.type === 'prise') {
      fencer.extension = 0.55;
    } else {
      fencer.extension += (0.12 - fencer.extension) * Math.min(1, dt * 12);
    }

    if (action.duration > 0 && t >= action.duration) {
      const wasAttack = this.isAttacking(fencer) || action.type === 'feint';
      fencer.action = idleAction();
      if (wasAttack) {
        fencer.lastAttackEnd = this.elapsed;
        if (this.priority === fencer.side) this.setPriority(null);
      }
    }
  }

  private calculateBlade(fencer: Fencer) {
    const forward = fencer.side === 'player' ? -1 : 1;
    const action = fencer.action;
    const lungeLean = action.type === 'lunge' ? Math.sin(clamp(action.elapsed / action.duration, 0, 1) * Math.PI) * 0.18 : 0;
    const sideSign = fencer.side === 'player' ? 1 : -1;
    fencer.bladeBase.set(
      fencer.position.x + sideSign * (0.25 + fencer.aim.x * 0.045),
      1.25 + fencer.extension * 0.07 + lungeLean * 0.15,
      fencer.position.z + forward * (0.42 + fencer.extension * 0.37 + lungeLean),
    );
    const length = this.config.weapon === 'sabre' ? 0.88 : 0.92;
    const direction = new THREE.Vector3(fencer.aim.x * 0.68 * sideSign, fencer.aim.y * 0.62, forward).normalize();
    if (action.type === 'parry') {
      direction.x += (fencer.parry % 2 === 0 ? -0.15 : 0.15) * sideSign;
      direction.normalize();
    }
    if (this.config.weapon === 'sabre' && this.isAttacking(fencer) && action.elapsed > action.hitAt * 0.5) {
      const cut = Math.sin(clamp((action.elapsed - action.hitAt * 0.5) / 0.28, 0, 1) * Math.PI);
      direction.x += cut * 0.48 * sideSign;
      direction.y += cut * 0.12;
      direction.normalize();
    }
    fencer.bladeTip.copy(fencer.bladeBase).addScaledVector(direction, length);
  }

  private bodyTargets(fencer: Fencer): BodyTarget[] {
    const p = fencer.position;
    const forward = fencer.side === 'player' ? -1 : 1;
    return [
      { center: new THREE.Vector3(p.x, 1.26, p.z), radius: 0.285, name: '躯干', region: 'torso' },
      { center: new THREE.Vector3(p.x, 1.64, p.z + forward * 0.03), radius: 0.18, name: '面罩 / 头部', region: 'head' },
      { center: new THREE.Vector3(p.x + (fencer.side === 'player' ? 0.25 : -0.25), 1.27, p.z + forward * 0.38), radius: 0.14, name: '持剑手臂', region: 'arm' },
      { center: new THREE.Vector3(p.x, 0.69, p.z), radius: 0.25, name: '腿部', region: 'leg' },
      { center: new THREE.Vector3(p.x, 0.18, p.z + forward * 0.22), radius: 0.18, name: '脚部', region: 'leg' },
    ];
  }

  private pointSegmentDistance(point: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3) {
    const ab = b.clone().sub(a);
    const lengthSq = ab.lengthSq();
    if (!lengthSq) return point.distanceTo(a);
    const t = clamp(point.clone().sub(a).dot(ab) / lengthSq, 0, 1);
    return point.distanceTo(a.clone().addScaledVector(ab, t));
  }

  private segmentDistance(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) {
    return Math.min(
      this.pointSegmentDistance(a, c, d), this.pointSegmentDistance(b, c, d),
      this.pointSegmentDistance(c, a, b), this.pointSegmentDistance(d, a, b),
    );
  }

  private checkCombat(attacker: Fencer, defender: Fencer) {
    const action = attacker.action;
    if (!this.isAttacking(attacker) || action.hasHit || action.elapsed < action.hitAt || action.elapsed > action.hitAt + 0.22) return;
    if (defender.action.type === 'parry') {
      const p = defender.action;
      const active = p.elapsed > 0.055 && p.elapsed < 0.245;
      const correct = p.parry === action.attackLine;
      const bladesNear = this.segmentDistance(attacker.bladeBase, attacker.bladeTip, defender.bladeBase, defender.bladeTip) < 0.72;
      if (active && correct && bladesNear) {
        action.hasHit = true;
        action.elapsed = Math.max(action.elapsed, action.hitAt + 0.2);
        defender.lastParry = this.elapsed;
        defender.stats.parries++;
        if (this.config.weapon !== 'epee') this.setPriority(defender.side);
        this.audio.blade();
        this.clashLight.position.copy(attacker.bladeTip).lerp(defender.bladeTip, 0.5);
        this.clashLight.intensity = 7;
        this.emit('parry', defender.side, `Parry ${p.parry} · ${defender.side === 'player' ? '格挡成功' : '对手格挡'}`, this.config.weapon === 'epee' ? 'Riposte 窗口已开启' : '优先权转移 · 现在反击');
        return;
      }
    }

    let contact: BodyTarget | undefined;
    let nearest = Infinity;
    for (const target of this.bodyTargets(defender)) {
      const distance = this.pointSegmentDistance(target.center, attacker.previousTip, attacker.bladeTip);
      if (distance < target.radius && distance < nearest) { contact = target; nearest = distance; }
    }
    if (!contact) return;
    action.hasHit = true;
    const validTarget = this.config.weapon === 'epee' || (this.config.weapon === 'foil' ? contact.region === 'torso' : contact.region !== 'leg');
    if (!validTarget) {
      this.audio.hit(false);
      this.arena.setScoreLights(attacker.side === 'player' ? 'white' : 'off', attacker.side === 'ai' ? 'white' : 'off');
      this.emit('invalid', attacker.side, '白灯 · 无效部位', `${contact.name}不在${WEAPON_INFO[this.config.weapon].name}有效部位内`, false);
      this.beginPhase('halt', 2.1);
      return;
    }
    if (this.config.weapon !== 'epee' && this.priority !== attacker.side) {
      this.audio.hit(false);
      this.emit('invalid', attacker.side, 'Counter-attack · 无优先权', '对手进攻仍在继续，本次命中不得分', false);
      return;
    }
    this.pendingHits.push({ side: attacker.side, at: this.elapsed, target: contact.name });
    attacker.stats.hits++;
    this.audio.hit(true);
    this.clashLight.position.copy(attacker.bladeTip);
    this.clashLight.color.set(attacker.side === 'player' ? '#b8f34a' : '#ef5c4d');
    this.clashLight.intensity = 5;
    this.emit('hit', attacker.side, this.config.weapon === 'sabre' ? 'Touché · 劈中' : 'Touché · 刺中', `${contact.name} · ${this.config.weapon === 'epee' ? '有效命中' : '优先权有效'}`, true);
    if (this.config.weapon !== 'epee') this.resolveHits();
  }

  private resolveHits() {
    if (!this.pendingHits.length || !['allez', 'halt'].includes(this.phase)) return;
    const first = this.pendingHits[0];
    const other = this.pendingHits.find((hit) => hit.side !== first.side && Math.abs(hit.at - first.at) <= 0.055);
    if (this.config.weapon === 'epee' && !other && this.elapsed - first.at < 0.06) return;
    const winners = other ? [first.side, other.side] : [first.side];
    for (const side of winners) this.score[side]++;
    const playerLight = winners.includes('player') ? 'green' : 'off';
    const aiLight = winners.includes('ai') ? 'red' : 'off';
    this.arena.setScoreLights(playerLight, aiLight);
    this.pendingHits = [];
    const double = winners.length === 2;
    this.emit('score', winners[0], double ? 'Double Touché · 双方得分' : `${winners[0] === 'player' ? '你' : '对手'}得分`, `${this.score.player} : ${this.score.ai}`, true);
    this.beginPhase('halt', 2.45);
  }

  private updateRound(dt: number) {
    this.phaseElapsed += dt;
    if (this.phase === 'en garde' && this.phaseElapsed >= this.phaseDuration) {
      this.beginPhase('ready', 1.05);
      this.emit('phase', undefined, 'Ready?', '保持专注 · 阅读肩臂预兆');
      this.audio.command();
    } else if (this.phase === 'ready' && this.phaseElapsed >= this.phaseDuration) {
      this.beginPhase('allez', 0);
      this.emit('phase', undefined, 'Allez!', '开始 · 控制距离');
      this.audio.command(true);
    } else if (this.phase === 'halt' && this.phaseElapsed >= this.phaseDuration) {
      const tiedAtTarget = this.score.player === this.score.ai && this.score.player >= this.config.targetScore;
      if (tiedAtTarget) {
        this.overtime = true;
        this.matchTime = 60;
        this.config = { ...this.config, targetScore: this.score.player + 1 };
        this.emit('phase', undefined, 'Sudden Death · 决一剑', '双灯平分，下一剑决定胜负');
      }
      if (!tiedAtTarget && (this.score.player >= this.config.targetScore || this.score.ai >= this.config.targetScore || (this.matchTime <= 0 && !this.overtime))) {
        this.finishMatch();
      } else {
        this.priority = null;
        this.resetPositions();
        this.beginPhase('en garde', 1.25);
        this.emit('phase', undefined, 'En garde', '回到预备线 · 优先权重置');
        this.audio.command();
      }
    }
  }

  private finishMatch() {
    this.phase = 'end';
    if (document.pointerLockElement) document.exitPointerLock();
    const playerWon = this.score.player > this.score.ai;
    this.emit('phase', undefined, playerWon ? 'Victoire · 胜利' : 'Match Terminé · 比赛结束', `最终比分 ${this.score.player} : ${this.score.ai}`);
  }

  private updateCamera(dt: number) {
    const targetBlend = this.view === 'first' ? 1 : 0;
    this.viewBlend += (targetBlend - this.viewBlend) * Math.min(1, dt * 8);
    if (this.phase === 'menu') {
      const angle = this.elapsed * 0.075;
      this.camera.position.set(4.5 + Math.sin(angle) * 0.35, 2.35, 4.9 + Math.cos(angle) * 0.3);
      this.camera.lookAt(0.2, 1.05, -0.15);
      this.camera.fov += (50 - this.camera.fov) * dt * 3;
      this.camera.updateProjectionMatrix();
      return;
    }
    const playerHead = new THREE.Vector3(this.player.position.x, 1.61, this.player.position.z - 0.035);
    const opponentLook = new THREE.Vector3(this.ai.position.x + this.player.aim.x * 0.3, 1.29 + this.player.aim.y * 0.35, this.ai.position.z);
    const thirdPosition = new THREE.Vector3(this.player.position.x + 2.75, 2.45, this.player.position.z + 3.65);
    if (this.bodyDistance() < 1.2) thirdPosition.x += 0.5;
    const thirdLook = new THREE.Vector3(this.ai.position.x * 0.35, 1.12, this.ai.position.z * 0.62);
    const firstDirection = opponentLook.sub(playerHead).normalize();
    const firstPosition = playerHead.clone().addScaledVector(firstDirection, 0.04);
    const position = thirdPosition.lerp(firstPosition, this.viewBlend);
    this.camera.position.lerp(position, Math.min(1, dt * 13));
    const look = thirdLook.lerp(new THREE.Vector3(this.ai.position.x + this.player.aim.x * 0.65, 1.3 + this.player.aim.y * 0.65, this.ai.position.z), this.viewBlend);
    this.camera.lookAt(look);
    const desiredFov = this.view === 'first' ? 68 : 54;
    this.camera.fov += (desiredFov - this.camera.fov) * Math.min(1, dt * 8);
    this.camera.updateProjectionMatrix();
  }

  private updateVisuals(dt: number) {
    for (const fencer of [this.player, this.ai]) {
      const snapshot: FencerSnapshot = {
        side: fencer.side,
        position: { x: fencer.position.x, y: fencer.position.y, z: fencer.position.z },
        aim: { ...fencer.aim }, action: { ...fencer.action }, extension: fencer.extension,
        parry: fencer.parry,
        bladeTip: { x: fencer.bladeTip.x, y: fencer.bladeTip.y, z: fencer.bladeTip.z },
        bladeBase: { x: fencer.bladeBase.x, y: fencer.bladeBase.y, z: fencer.bladeBase.z },
        speed: fencer.speed, viewMode: this.view,
      };
      fencer.visual.update(snapshot, dt, this.view);
      const points = this.trailPoints[fencer.side];
      if (this.isAttacking(fencer) || fencer.action.type === 'feint') {
        points.push(fencer.bladeTip.clone());
        if (points.length > 16) points.shift();
      } else if (points.length) points.shift();
      this.trails[fencer.side].geometry.setFromPoints(points);
      this.trails[fencer.side].visible = points.length > 1;
    }
    this.clashLight.intensity *= Math.pow(0.015, dt);
    this.arena.update(this.elapsed);
  }

  private publish() {
    const distance = this.bodyDistance();
    const zone = distance > 3.2 ? '安全距离' : distance > 2.25 ? '威胁距离' : distance > 1.3 ? '弓步距离' : '内围距离';
    let playerAction = ACTION_NAMES[this.player.action.type] ?? this.player.action.type;
    if (this.player.action.isRiposte) playerAction = 'Riposte · 防守反击';
    if (this.player.action.disengaged) playerAction = 'Disengagement · 转移进攻';
    this.onUpdate({
      phase: this.phase, score: { ...this.score }, time: Math.max(0, this.matchTime), distance, zone,
      priority: this.config.weapon === 'epee' ? null : this.priority, view: this.view,
      playerAction, aiAction: ACTION_NAMES[this.ai.action.type] ?? this.ai.action.type,
      parry: this.player.parry, stats: { ...this.player.stats }, overtime: this.overtime,
    });
  }

  private simulate(dt: number) {
    if (this.phase !== 'pause') this.elapsed += dt;
    if (['en garde', 'ready', 'allez', 'halt'].includes(this.phase)) this.updateRound(dt);
    if (this.phase === 'allez') {
      this.matchTime -= dt;
      if (this.matchTime <= 0) {
        this.matchTime = 0;
        if (this.score.player === this.score.ai && !this.overtime) {
          this.overtime = true;
          this.matchTime = 60;
          this.beginPhase('halt', 1.8);
          this.emit('phase', undefined, 'Sudden Death · 决一剑', '下一剑决定胜负');
        } else if (!this.overtime) this.beginPhase('halt', 0.4);
        else this.finishMatch();
      }
      this.updatePlayer(dt);
      this.updateAI(dt);
    }
    if (['en garde', 'ready', 'allez'].includes(this.phase)) {
      this.updateAction(this.player, dt);
      this.updateAction(this.ai, dt);
    } else if (this.phase === 'menu') {
      this.player.aim.y = Math.sin(this.elapsed * 0.7) * 0.05;
      this.ai.aim.y = Math.cos(this.elapsed * 0.65) * 0.05;
    }

    for (const fencer of [this.player, this.ai]) {
      fencer.previousTip.copy(fencer.bladeTip);
      this.calculateBlade(fencer);
    }
    if (this.phase === 'allez') {
      this.checkCombat(this.player, this.ai);
      if (this.phase === 'allez') this.checkCombat(this.ai, this.player);
      this.resolveHits();
    }
  }

  private loop = () => {
    if (this.destroyed) return;
    this.animationFrame = requestAnimationFrame(this.loop);
    const renderDt = Math.min(this.clock.getDelta(), 0.5);
    if (this.phase === 'pause') {
      this.accumulator = 0;
    } else {
      this.accumulator += renderDt;
      const fixedStep = 1 / 60;
      while (this.accumulator >= fixedStep) {
        this.simulate(fixedStep);
        this.accumulator -= fixedStep;
      }
    }
    this.updateVisuals(renderDt);
    this.updateCamera(renderDt);
    this.renderer.render(this.scene, this.camera);
    this.uiElapsed += renderDt;
    if (this.uiElapsed > 0.045) { this.publish(); this.uiElapsed = 0; }
  };

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.animationFrame);
    window.removeEventListener('resize', this.resize);
    this.player.visual.dispose();
    this.ai.visual.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
