export type Weapon = 'foil' | 'epee' | 'sabre';
export type Side = 'player' | 'ai';
export type ViewMode = 'third' | 'first';
export type GamePhase = 'menu' | 'en garde' | 'ready' | 'allez' | 'halt' | 'pause' | 'end';
export type AIStyle = 'counter' | 'aggressive' | 'deceiver';
export type Difficulty = 'rookie' | 'advanced' | 'master';
export type ActionType =
  | 'idle' | 'advance' | 'retreat' | 'halfstep' | 'glissade'
  | 'lunge' | 'fleche' | 'ballestra' | 'attack' | 'feint'
  | 'parry' | 'prise' | 'hit';

export interface ActionState {
  type: ActionType;
  elapsed: number;
  duration: number;
  hitAt: number;
  hasHit: boolean;
  parry?: number;
  attackLine?: number;
  startAimX?: number;
  startAimY?: number;
  disengaged?: boolean;
  isRiposte?: boolean;
  isRemise?: boolean;
  isFeint?: boolean;
  owner?: Side;
}

export interface FencerSnapshot {
  side: Side;
  position: { x: number; y: number; z: number };
  aim: { x: number; y: number };
  action: ActionState;
  extension: number;
  parry: number;
  bladeTip: { x: number; y: number; z: number };
  bladeBase: { x: number; y: number; z: number };
  speed: number;
  viewMode?: ViewMode;
}

export interface MatchConfig {
  weapon: Weapon;
  style: AIStyle;
  difficulty: Difficulty;
  assists: boolean;
  targetScore: number;
}

export interface CombatEvent {
  type: 'action' | 'parry' | 'hit' | 'score' | 'invalid' | 'phase' | 'priority' | 'blade';
  side?: Side;
  title: string;
  detail?: string;
  valid?: boolean;
  score?: { player: number; ai: number };
}

export const WEAPON_INFO: Record<Weapon, { name: string; french: string; target: string; rule: string; index: string }> = {
  foil: { name: '花剑', french: 'FOIL', target: '躯干有效', rule: '优先权规则', index: '01' },
  epee: { name: '重剑', french: 'ÉPÉE', target: '全身有效', rule: '无优先权 · 双灯', index: '02' },
  sabre: { name: '佩剑', french: 'SABRE', target: '腰部以上有效', rule: '优先权 · 劈刺', index: '03' },
};

export const AI_INFO: Record<AIStyle, { name: string; french: string; description: string }> = {
  counter: { name: '防守反击', french: 'THE TACTICIAN', description: '控制距离，诱导出手，格挡后反击。' },
  aggressive: { name: '激进压迫', french: 'THE CHASER', description: '持续压缩空间，善用 Flèche 抢攻。' },
  deceiver: { name: '佯攻变线', french: 'THE ILLUSIONIST', description: '阅读格挡习惯，以 Feint 欺骗防线。' },
};

export const PARRY_NAMES = ['内侧低位', '外侧低位', '外侧中位', '内侧中位', '外侧高位', '外侧高位', '内侧低位', '外侧低位'];
