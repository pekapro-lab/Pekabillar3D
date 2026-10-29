import { freshTracker } from "./physics";
import { initialScore } from "./rules";
import { makeTable, openingPlacement, rackBalls } from "./table";
import type { ClothId, Mode, World } from "./types";

const BEST_KEY = "pekabillar3d-best-run";
const CLOTH_KEY = "pekabillar3d-cloth";

export function readCloth(): ClothId {
  if (typeof window === "undefined") return "green";
  try {
    const value = localStorage.getItem(CLOTH_KEY);
    if (value === "red" || value === "blue" || value === "green") return value;
  } catch {
    /* ignore quota */
  }
  return "green";
}

export function writeCloth(value: ClothId): void {
  try {
    localStorage.setItem(CLOTH_KEY, value);
  } catch {
    /* ignore quota */
  }
}

export function readBestRun(): number {
  if (typeof window === "undefined") return 0;
  try {
    const n = Number(localStorage.getItem(BEST_KEY) ?? "0");
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

export function writeBestRun(value: number): void {
  try {
    localStorage.setItem(BEST_KEY, String(value));
  } catch {
    /* ignore quota */
  }
}

export function createWorld(): World {
  const table = makeTable();
  const open = openingPlacement(table);
  return {
    table,
    balls: rackBalls(table),
    aimAngle: open.angle,
    aimPower: 86,
    english: 0,
    follow: 0,
    cloth: readCloth(),
    moving: false,
    phase: "menu",
    mode: "ai",
    difficulty: "medium",
    score: initialScore(),
    tracker: freshTracker(),
    generation: 1,
    bestRun: readBestRun(),
    aiGhost: null,
    thinking: false,
    opening: true,
    breakShot: false,
  };
}

export function resetRack(world: World, mode: Mode): void {
  const open = openingPlacement(world.table);
  world.balls = rackBalls(world.table);
  world.aimAngle = open.angle;
  world.aimPower = 86;
  world.english = 0;
  world.follow = 0;
  world.moving = false;
  world.phase = "play";
  world.mode = mode;
  world.score = initialScore();
  world.tracker = freshTracker();
  world.generation += 1;
  world.aiGhost = null;
  world.thinking = false;
  world.opening = true;
  world.breakShot = false;
}
