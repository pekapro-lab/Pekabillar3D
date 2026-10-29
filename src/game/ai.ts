import { BALL_R, inKitchen, isBallOn, onCloth } from "./table";
import type { Ball, Difficulty, Pocket, ScoreState, Table } from "./types";

export interface AiShot {
  ball: Ball;
  pocket: Pocket;
  angle: number;
  power: number;
  ghostX: number;
  ghostZ: number;
  clear: boolean;
}

function blocked(x1: number, z1: number, x2: number, z2: number, balls: Ball[], ignore: number[]): boolean {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const len = Math.hypot(dx, dz);
  if (len < 0.0001) return false;
  const dirX = dx / len;
  const dirZ = dz / len;
  for (const ball of balls) {
    if (ball.isPocketed || ignore.includes(ball.id)) continue;
    const toX = ball.x - x1;
    const toZ = ball.z - z1;
    const proj = toX * dirX + toZ * dirZ;
    if (proj < BALL_R || proj > len - BALL_R) continue;
    const perpX = toX - proj * dirX;
    const perpZ = toZ - proj * dirZ;
    const min = BALL_R * 1.9;
    if (perpX * perpX + perpZ * perpZ < min * min) return true;
  }
  return false;
}

export function chooseAiShot(
  cue: Ball,
  balls: Ball[],
  table: Table,
  legal: Ball[],
  difficulty: Difficulty,
): AiShot | null {
  let best: AiShot | null = null;
  let bestScore = Infinity;

  for (const target of legal) {
    for (const pocket of table.pockets) {
      const toX = pocket.x - target.x;
      const toZ = pocket.z - target.z;
      const potDist = Math.hypot(toX, toZ);
      if (potDist < 0.05) continue;
      const nx = toX / potDist;
      const nz = toZ / potDist;
      const potBlocked = blocked(target.x, target.z, pocket.x, pocket.z, balls, [cue.id, target.id]);
      const ghostX = target.x - nx * (cue.radius + target.radius);
      const ghostZ = target.z - nz * (cue.radius + target.radius);
      const aimX = ghostX - cue.x;
      const aimZ = ghostZ - cue.z;
      const cueDist = Math.hypot(aimX, aimZ);
      if (cueDist < 0.02) continue;
      const cueBlocked = blocked(cue.x, cue.z, ghostX, ghostZ, balls, [cue.id, target.id]);
      const angle = Math.atan2(aimX, aimZ);
      const dirX = aimX / cueDist;
      const dirZ = aimZ / cueDist;
      const dot = Math.max(-1, Math.min(1, dirX * nx + dirZ * nz));
      const cut = Math.acos(dot);
      if (cut > 1.35) continue;
      const cutLoss = 1 / Math.max(0.28, Math.cos(cut));
      let speed = (cueDist * 0.62 + potDist * 1.05) * cutLoss;
      speed = Math.max(1.25, Math.min(3.15, speed));
      let power = ((speed - 0.48) / 2.85) * 100;
      power = Math.max(12, Math.min(96, power));

      let penalty = cueDist * 2.2 + potDist * 1.6 + cut * 3.4;
      if (potBlocked) penalty += 80;
      if (cueBlocked) penalty += 80;
      if (target.type === "eight") penalty += 1.5;
      const clear = !potBlocked && !cueBlocked && cut < 1.05;
      if (clear) penalty -= 8;

      if (penalty < bestScore) {
        bestScore = penalty;
        best = { ball: target, pocket, angle, power, ghostX, ghostZ, clear };
      }
    }
  }

  if (!best) return null;

  const error =
    difficulty === "easy" ? { angle: 0.07, power: 0.18 } : difficulty === "medium" ? { angle: 0.028, power: 0.08 } : { angle: 0.006, power: 0.025 };

  return {
    ...best,
    angle: best.angle + (Math.random() - 0.5) * 2 * error.angle,
    power: Math.max(10, Math.min(100, best.power * (1 + (Math.random() - 0.5) * 2 * error.power))),
  };
}

export function aiCueSpot(balls: Ball[], table: Table, kitchen: boolean, legal: Ball[]): { x: number; z: number } {
  const cue = balls.find((b) => b.isCue);
  const ignore = cue ? [cue.id] : [];
  const spots: { x: number; z: number }[] = [];
  if (kitchen) {
    for (let ix = -5; ix <= 5; ix++) {
      for (let iz = 0; iz <= 5; iz++) {
        const x = ix * 0.09;
        const z = table.headZ + 0.05 + iz * 0.075;
        if (!inKitchen(x, z, table) || overlaps(x, z, balls, ignore)) continue;
        spots.push({ x, z });
      }
    }
  } else {
    for (let ix = -6; ix <= 6; ix++) {
      for (let iz = -8; iz <= 8; iz++) {
        const x = ix * (table.halfW / 7);
        const z = iz * (table.halfL / 9);
        if (!onCloth(x, z, table) || overlaps(x, z, balls, ignore)) continue;
        spots.push({ x, z });
      }
    }
  }

  const targets = legal.length ? legal : balls.filter((ball) => !ball.isPocketed && !ball.isCue);
  let best = spots[0] ?? { x: 0, z: kitchen ? table.headZ + 0.18 : 0 };
  let bestScore = -1;
  for (const spot of spots) {
    let score = 0;
    for (const ball of targets) {
      if (blocked(spot.x, spot.z, ball.x, ball.z, balls, [...ignore, ball.id])) continue;
      score += 5 + 1 / (0.35 + Math.hypot(ball.x - spot.x, ball.z - spot.z));
    }
    if (score > bestScore) {
      bestScore = score;
      best = spot;
    }
  }
  return best;
}

export function safetyAim(cue: Ball, ball: Ball): { angle: number; power: number } {
  return {
    angle: Math.atan2(ball.x - cue.x, ball.z - cue.z),
    power: 48,
  };
}

function overlaps(x: number, z: number, balls: Ball[], ignore: number[]): boolean {
  return balls.some((ball) => {
    if (ball.isPocketed || ignore.includes(ball.id)) return false;
    const dx = ball.x - x;
    const dz = ball.z - z;
    return dx * dx + dz * dz < (BALL_R * 2.1) ** 2;
  });
}

export function legalTargets(balls: Ball[], score: ScoreState): Ball[] {
  return balls.filter((ball) => isBallOn(ball, score));
}
