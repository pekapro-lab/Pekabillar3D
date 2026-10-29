export type BallType = "cue" | "solid" | "stripe" | "eight";
export type Group = "solid" | "stripe";
export type Difficulty = "easy" | "medium" | "hard";
export type Mode = "ai" | "hotseat";
export type PlayerId = 1 | 2;
export type ShotSound = "pot" | "foul" | "miss" | "win";

export interface Spot {
  x: number;
  z: number;
}

export interface Ball {
  id: number;
  number: number;
  type: BallType;
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Velocidad de rodadura. Si iguala a vx/vz, la bola rueda sin deslizar. */
  sx: number;
  sz: number;
  /** Efecto lateral: positivo es derecha (giro horario visto desde arriba). */
  side: number;
  radius: number;
  color: string;
  stripe: boolean;
  isCue: boolean;
  isPocketed: boolean;
  spot: Spot | null;
}

export interface Pocket {
  id: number;
  x: number;
  z: number;
  r: number;
}

export interface Table {
  width: number;
  length: number;
  halfW: number;
  halfL: number;
  /** Línea de cabecera. La cocina es z mayor (lado de la salida). */
  headZ: number;
  /** Punto de pie, donde apoya el vértice del triángulo. */
  footZ: number;
  pockets: Pocket[];
}

export interface Tracker {
  first: Ball | null;
  pocketed: Ball[];
  cuePotted: boolean;
  cueHasHit: boolean;
  railAfterContact: boolean;
}

export interface ScoreState {
  groups: Record<PlayerId, Group | null>;
  open: boolean;
  onEight: boolean;
  player: PlayerId;
  ballInHand: boolean;
  /** Colocación solo en la cocina (salida), no bola en mano libre. */
  kitchen: boolean;
  over: boolean;
  winner: PlayerId | null;
  message: string;
  log: string[];
  run: number;
}

export interface ShotResult {
  next: ScoreState;
  respotIds: number[];
  pickupCue: boolean;
  sound: ShotSound;
}

export interface World {
  table: Table;
  balls: Ball[];
  aimAngle: number;
  aimPower: number;
  /** -1 izquierda, 1 derecha. */
  english: number;
  /** -1 retroceso, 1 avance. */
  follow: number;
  moving: boolean;
  phase: "menu" | "play";
  mode: Mode;
  difficulty: Difficulty;
  score: ScoreState;
  tracker: Tracker;
  generation: number;
  bestRun: number;
  aiGhost: Spot | null;
  thinking: boolean;
  opening: boolean;
  breakShot: boolean;
}
