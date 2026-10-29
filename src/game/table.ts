import type { Ball, BallType, Group, PlayerId, ScoreState, Spot, Table } from "./types";

export const BALL_R = 0.036;

const SOLIDS = ["#e6b325", "#1d4ed8", "#d02323", "#6d28d9", "#ea6a12", "#178a3e", "#7a2433"];

export function ballStyle(number: number): { color: string; stripe: boolean; type: BallType } {
  if (number <= 0) return { color: "#f4f0e6", stripe: false, type: "cue" };
  if (number === 8) return { color: "#141414", stripe: false, type: "eight" };
  const stripe = number > 8;
  const color = SOLIDS[(stripe ? number - 9 : number - 1) % SOLIDS.length] ?? "#d02323";
  return { color, stripe, type: stripe ? "stripe" : "solid" };
}

export function ballName(ball: Pick<Ball, "type" | "number">): string {
  if (ball.type === "cue") return "blanca";
  if (ball.type === "eight") return "bola 8";
  if (ball.type === "solid") return `lisa ${ball.number}`;
  return `rayada ${ball.number}`;
}

export function groupName(group: Group | null): string {
  if (group === "solid") return "lisas";
  if (group === "stripe") return "rayadas";
  return "sin grupo";
}

export function otherGroup(group: Group): Group {
  return group === "solid" ? "stripe" : "solid";
}

export function makeTable(): Table {
  const width = 1.78;
  const length = 3.56;
  const halfW = width / 2;
  const halfL = length / 2;
  const pr = 0.1;
  return {
    width,
    length,
    halfW,
    halfL,
    headZ: halfL / 2,
    footZ: -halfL / 2,
    pockets: [
      { id: 1, x: -halfW, z: -halfL, r: pr },
      { id: 2, x: halfW, z: -halfL, r: pr },
      { id: 3, x: -halfW, z: halfL, r: pr },
      { id: 4, x: halfW, z: halfL, r: pr },
      { id: 5, x: -halfW, z: 0, r: pr },
      { id: 6, x: halfW, z: 0, r: pr },
    ],
  };
}

function makeBall(number: number, x: number, z: number, spot: Spot | null): Ball {
  const style = ballStyle(number);
  return {
    id: number,
    number,
    type: style.type,
    x,
    z,
    vx: 0,
    vz: 0,
    radius: BALL_R,
    color: style.color,
    stripe: style.stripe,
    isCue: style.type === "cue",
    isPocketed: false,
    spot,
  };
}

/** Triángulo reglamentario: la 8 en el centro y esquinas traseras de distinto grupo. */
const RACK: number[][] = [
  [1],
  [9, 2],
  [10, 8, 3],
  [11, 7, 12, 4],
  [6, 13, 5, 14, 15],
];

export function rackBalls(table: Table): Ball[] {
  const open = openingPlacement(table);
  const balls: Ball[] = [makeBall(0, open.x, open.z, null)];
  const gap = BALL_R * 2.02;
  const rowStep = gap * Math.sin(Math.PI / 3);
  for (let row = 0; row < RACK.length; row++) {
    const nums = RACK[row] ?? [];
    const z = table.footZ - row * rowStep;
    for (let col = 0; col < nums.length; col++) {
      const number = nums[col] ?? 1;
      const x = (col - (nums.length - 1) / 2) * gap;
      const spot = number === 8 ? { x: 0, z: table.footZ } : null;
      balls.push(makeBall(number, x, z, spot));
    }
  }
  return balls;
}

export function openingPlacement(table: Table): { x: number; z: number; angle: number } {
  const x = 0.045;
  const z = table.headZ + (table.halfL - table.headZ) * 0.55;
  const angle = Math.atan2(-x, table.footZ - z);
  return { x, z, angle };
}

export function onCloth(x: number, z: number, table: Table): boolean {
  const margin = BALL_R + 0.012;
  if (Math.abs(x) > table.halfW - margin || Math.abs(z) > table.halfL - margin) return false;
  for (const pocket of table.pockets) {
    const dx = x - pocket.x;
    const dz = z - pocket.z;
    const keep = pocket.r + BALL_R * 0.35;
    if (dx * dx + dz * dz < keep * keep) return false;
  }
  return true;
}

export function inKitchen(x: number, z: number, table: Table): boolean {
  return onCloth(x, z, table) && z >= table.headZ - 0.001;
}

export function cueBall(balls: Ball[]): Ball {
  const cue = balls.find((b) => b.isCue);
  if (!cue) throw new Error("No hay blanca");
  return cue;
}

export function isBallOn(ball: Ball, score: ScoreState): boolean {
  if (ball.isCue || ball.isPocketed) return false;
  if (score.onEight) return ball.type === "eight";
  if (score.open || !score.groups[score.player]) return ball.type === "solid" || ball.type === "stripe";
  return ball.type === score.groups[score.player];
}

export function countLeft(balls: Ball[], group: Group): number {
  return balls.filter((ball) => ball.type === group && !ball.isPocketed).length;
}

export function playerLabel(player: PlayerId, mode: "ai" | "hotseat"): string {
  if (mode === "ai") return player === 1 ? "Tú" : "IA";
  return player === 1 ? "Jugador 1" : "Jugador 2";
}

export function findOpenSpot(ball: Ball, balls: Ball[], table: Table): Spot {
  const origin = ball.spot ?? { x: 0, z: table.footZ };
  const need = BALL_R * 2.08;
  const blocked = (x: number, z: number) =>
    balls.some((other) => {
      if (other.id === ball.id || other.isPocketed) return false;
      const dx = other.x - x;
      const dz = other.z - z;
      return dx * dx + dz * dz < need * need;
    });
  const inside = (x: number, z: number) =>
    Math.abs(x) < table.halfW - BALL_R - 0.02 && Math.abs(z) < table.halfL - BALL_R - 0.02;

  if (inside(origin.x, origin.z) && !blocked(origin.x, origin.z)) return origin;
  for (const dir of [1, -1]) {
    for (let step = 1; step <= 16; step++) {
      const z = origin.z + dir * step * BALL_R * 2.15;
      if (!inside(origin.x, z)) continue;
      if (!blocked(origin.x, z)) return { x: origin.x, z };
    }
  }
  return { x: 0, z: 0 };
}

export function placeCue(balls: Ball[], x: number, z: number): void {
  const cue = cueBall(balls);
  cue.isPocketed = false;
  cue.x = x;
  cue.z = z;
  cue.vx = 0;
  cue.vz = 0;
}

export function spotClear(balls: Ball[], x: number, z: number, ignoreId = 0): boolean {
  const need = BALL_R * 2.05;
  return !balls.some((ball) => {
    if (ball.id === ignoreId || ball.isPocketed) return false;
    const dx = ball.x - x;
    const dz = ball.z - z;
    return dx * dx + dz * dz < need * need;
  });
}
