import type { Ball, Table, Tracker } from "./types";

export const FRICTION = 0.78;
export const RESTITUTION = 0.94;
export const CUSHION_RESTITUTION = 0.78;
export const BALL_FRICTION = 0.16;
export const CUSHION_GRAB = 0.08;
export const SPIN_GRIP = 2.5;
export const SWERVE = 1.15;
export const MIN_VEL = 0.04;

export function speedFromPower(power: number): number {
  const p = Math.max(0, Math.min(100, power));
  return 0.48 + (p / 100) * 2.85;
}

export function strike(ball: Ball, angle: number, power: number, english = 0, follow = 0): void {
  const speed = speedFromPower(power);
  const e = Math.max(-1, Math.min(1, english));
  const f = Math.max(-1, Math.min(1, follow));
  const loss = 1 - 0.05 * (e * e + f * f);
  const v = speed * loss;
  const dx = Math.sin(angle);
  const dz = Math.cos(angle);
  ball.vx = dx * v;
  ball.vz = dz * v;
  const geared = v * f * 1.45;
  ball.sx = dx * geared;
  ball.sz = dz * geared;
  ball.side = v * e * 0.9;
  ball.isPocketed = false;
}

export function freshTracker(): Tracker {
  return {
    first: null,
    pocketed: [],
    cuePotted: false,
    cueHasHit: false,
    railAfterContact: false,
  };
}

function pocketHit(ball: Ball, table: Table) {
  let best: (typeof table.pockets)[number] | null = null;
  let bestD = Infinity;
  for (const pocket of table.pockets) {
    const dx = ball.x - pocket.x;
    const dz = ball.z - pocket.z;
    const d = dx * dx + dz * dz;
    const reach = pocket.r * 0.92;
    if (d < reach * reach && d < bestD) {
      best = pocket;
      bestD = d;
    }
  }
  return best;
}

function nearPocket(ball: Ball, table: Table): boolean {
  for (const pocket of table.pockets) {
    const dx = ball.x - pocket.x;
    const dz = ball.z - pocket.z;
    const mouth = pocket.r + ball.radius * 0.85;
    if (dx * dx + dz * dz < mouth * mouth) return true;
  }
  return false;
}

function escapedPocket(ball: Ball, table: Table): boolean {
  return (
    Math.abs(ball.x) > table.halfW - ball.radius * 0.85 ||
    Math.abs(ball.z) > table.halfL - ball.radius * 0.85
  );
}

function drop(ball: Ball, pocket: { x: number; z: number }, tracker: Tracker | null): void {
  ball.isPocketed = true;
  ball.vx = 0;
  ball.vz = 0;
  ball.sx = 0;
  ball.sz = 0;
  ball.side = 0;
  ball.x = pocket.x;
  ball.z = pocket.z;
  if (!tracker) return;
  if (ball.isCue) tracker.cuePotted = true;
  else if (!tracker.pocketed.some((p) => p.id === ball.id)) tracker.pocketed.push(ball);
}

function bounceRail(ball: Ball, tangent: "z" | "x", sign: number): void {
  const kick = 0.62 * ball.side * sign;
  if (tangent === "z") ball.vz += kick;
  else ball.vx += kick;
  ball.side *= 0.42;
}

function resolveCushion(ball: Ball, table: Table): boolean {
  let hit = false;
  const minX = -table.halfW + ball.radius;
  const maxX = table.halfW - ball.radius;
  const minZ = -table.halfL + ball.radius;
  const maxZ = table.halfL - ball.radius;
  if (ball.x < minX) {
    ball.x = minX;
    if (ball.vx < 0) {
      ball.vx = -ball.vx * CUSHION_RESTITUTION;
      ball.vz *= 1 - CUSHION_GRAB;
      bounceRail(ball, "z", -1);
      hit = true;
    }
  } else if (ball.x > maxX) {
    ball.x = maxX;
    if (ball.vx > 0) {
      ball.vx = -ball.vx * CUSHION_RESTITUTION;
      ball.vz *= 1 - CUSHION_GRAB;
      bounceRail(ball, "z", 1);
      hit = true;
    }
  }
  if (ball.z < minZ) {
    ball.z = minZ;
    if (ball.vz < 0) {
      ball.vz = -ball.vz * CUSHION_RESTITUTION;
      ball.vx *= 1 - CUSHION_GRAB;
      bounceRail(ball, "x", -1);
      hit = true;
    }
  } else if (ball.z > maxZ) {
    ball.z = maxZ;
    if (ball.vz > 0) {
      ball.vz = -ball.vz * CUSHION_RESTITUTION;
      ball.vx *= 1 - CUSHION_GRAB;
      bounceRail(ball, "x", 1);
      hit = true;
    }
  }
  return hit;
}

function collide(a: Ball, b: Ball): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const distSq = dx * dx + dz * dz;
  const minDist = a.radius + b.radius;
  if (distSq === 0 || distSq >= minDist * minDist) return 0;

  const dist = Math.sqrt(distSq);
  const nx = dx / dist;
  const nz = dz / dist;
  const overlap = minDist - dist;
  const slop = 0.0006;
  if (overlap > slop) {
    const corr = (overlap - slop) * 0.75;
    a.x -= nx * corr * 0.5;
    a.z -= nz * corr * 0.5;
    b.x += nx * corr * 0.5;
    b.z += nz * corr * 0.5;
  }

  const rvx = b.vx - b.side * nz - (a.vx + a.side * nz);
  const rvz = b.vz + b.side * nx - (a.vz - a.side * nx);
  const relN = rvx * nx + rvz * nz;
  const bothSlow = a.vx * a.vx + a.vz * a.vz + b.vx * b.vx + b.vz * b.vz < MIN_VEL * MIN_VEL * 4;
  if (bothSlow) {
    a.vx = 0;
    a.vz = 0;
    b.vx = 0;
    b.vz = 0;
    a.sx = 0;
    a.sz = 0;
    b.sx = 0;
    b.sz = 0;
    a.side = 0;
    b.side = 0;
    return 0;
  }
  if (relN >= 0) return 0;

  const impact = -relN;
  const impulse = ((1 + RESTITUTION) * impact) / 2;
  a.vx -= impulse * nx;
  a.vz -= impulse * nz;
  b.vx += impulse * nx;
  b.vz += impulse * nz;

  const tx = rvx - relN * nx;
  const tz = rvz - relN * nz;
  const tanSpeed = Math.hypot(tx, tz);
  if (tanSpeed > 0.0001) {
    const jt = Math.min(tanSpeed / 2, BALL_FRICTION * impulse);
    const txu = tx / tanSpeed;
    const tzu = tz / tanSpeed;
    a.vx += jt * txu;
    a.vz += jt * tzu;
    b.vx -= jt * txu;
    b.vz -= jt * tzu;
    a.side *= 0.62;
    b.side *= 0.62;
  }
  return impact;
}

export function stepSimulation(balls: Ball[], table: Table, dt: number, tracker: Tracker | null, impacts?: number[]): void {
  for (const ball of balls) {
    if (ball.isPocketed) {
      ball.vx = 0;
      ball.vz = 0;
      continue;
    }
    const drag = Math.max(0, 1 - FRICTION * dt);
    const slipX = ball.vx - ball.sx;
    const slipZ = ball.vz - ball.sz;
    const slip = Math.hypot(slipX, slipZ);
    if (slip > 0.0008) {
      const close = Math.min(1, SPIN_GRIP * dt);
      ball.vx -= (slipX * close) / 3.5;
      ball.vz -= (slipZ * close) / 3.5;
      ball.sx += (slipX * close * 2.5) / 3.5;
      ball.sz += (slipZ * close * 2.5) / 3.5;
    }
    const speed = Math.hypot(ball.vx, ball.vz);
    if (speed > 0.08 && Math.abs(ball.side) > 0.03 && slip > 0.04) {
      const grip = Math.min(1, slip / speed);
      const bend = ball.side * grip * SWERVE * dt;
      const vx = ball.vx;
      const vz = ball.vz;
      ball.vx += (vz / speed) * bend;
      ball.vz -= (vx / speed) * bend;
    }
    ball.vx *= drag;
    ball.vz *= drag;
    ball.sx *= drag;
    ball.sz *= drag;
    ball.side *= Math.max(0, 1 - 0.45 * dt);
    const speedSq = ball.vx * ball.vx + ball.vz * ball.vz;
    const spinSq = ball.sx * ball.sx + ball.sz * ball.sz + ball.side * ball.side;
    if (speedSq < MIN_VEL * MIN_VEL && spinSq < MIN_VEL * MIN_VEL) {
      ball.vx = 0;
      ball.vz = 0;
      ball.sx = 0;
      ball.sz = 0;
      ball.side = 0;
    } else {
      ball.x += ball.vx * dt;
      ball.z += ball.vz * dt;
    }
  }

  for (const ball of balls) {
    if (ball.isPocketed) continue;
    const pocket = pocketHit(ball, table);
    if (pocket) drop(ball, pocket, tracker);
  }

  for (let pass = 0; pass < 4; pass++) {
    for (const ball of balls) {
      if (ball.isPocketed) continue;
      if (nearPocket(ball, table)) {
        const pocket = pocketHit(ball, table);
        if (pocket) {
          drop(ball, pocket, tracker);
          continue;
        }
        const jawHit = resolveCushion(ball, table);
        if (tracker?.cueHasHit && (jawHit || escapedPocket(ball, table))) tracker.railAfterContact = true;
        continue;
      }
      if (resolveCushion(ball, table) && tracker?.cueHasHit) tracker.railAfterContact = true;
    }

    for (let i = 0; i < balls.length; i++) {
      for (let j = i + 1; j < balls.length; j++) {
        const a = balls[i];
        const b = balls[j];
        if (a.isPocketed || b.isPocketed) continue;
        const impact = collide(a, b);
        if (pass === 0 && impact > 0.18) impacts?.push(impact);
        if (impact > 0 && tracker && !tracker.first && (a.isCue || b.isCue)) {
          tracker.first = a.isCue ? b : a;
          tracker.cueHasHit = true;
        }
      }
    }
  }
}

export function anyMoving(balls: Ball[]): boolean {
  return balls.some((ball) => !ball.isPocketed && ball.vx * ball.vx + ball.vz * ball.vz > MIN_VEL * MIN_VEL);
}

export function aimContact(
  cue: Ball,
  balls: Ball[],
  angle: number,
): { x: number; z: number; ball: Ball } | null {
  const dx = Math.sin(angle);
  const dz = Math.cos(angle);
  let bestT = Infinity;
  let best: Ball | null = null;
  for (const ball of balls) {
    if (ball.isPocketed || ball.isCue) continue;
    const fx = ball.x - cue.x;
    const fz = ball.z - cue.z;
    const proj = fx * dx + fz * dz;
    if (proj <= 0) continue;
    const perpX = fx - proj * dx;
    const perpZ = fz - proj * dz;
    const distSq = perpX * perpX + perpZ * perpZ;
    const rad = cue.radius + ball.radius - 0.001;
    if (distSq > rad * rad) continue;
    const t = proj - Math.sqrt(rad * rad - distSq);
    if (t > 0.001 && t < bestT) {
      bestT = t;
      best = ball;
    }
  }
  if (!best) return null;
  return { x: cue.x + dx * bestT, z: cue.z + dz * bestT, ball: best };
}

export const FIXED_DT = 1 / 120;
