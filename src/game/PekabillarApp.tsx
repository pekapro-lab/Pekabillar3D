import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import { aiCueSpot, chooseAiShot, legalTargets, safetyAim } from "./ai";
import { playCue, playFoul, playWin, unlockAudio } from "./audio";
import { freshTracker, strike } from "./physics";
import { evaluateShot, statusLabel } from "./rules";
import { TableScene, type ClothPointer } from "./TableScene";
import {
  ballName,
  countLeft,
  cueBall,
  findOpenSpot,
  groupName,
  inKitchen,
  onCloth,
  placeCue,
  playerLabel,
  spotClear,
} from "./table";
import type { Ball, Difficulty, Group, Mode, ScoreState } from "./types";
import { createWorld, resetRack, writeBestRun } from "./world";

const DIFFICULTIES: { id: Difficulty; label: string }[] = [
  { id: "easy", label: "Fácil" },
  { id: "medium", label: "Media" },
  { id: "hard", label: "Difícil" },
];

export function PekabillarApp() {
  const worldRef = useRef(createWorld());
  const inputRef = useRef<(event: ClothPointer) => void>(() => {});
  const settleRef = useRef<() => void>(() => {});
  const shootRef = useRef<() => void>(() => {});
  const [rev, setRev] = useState(0);
  const [aimTick, setAimTick] = useState(0);
  const [thinking, setThinking] = useState(false);
  const aiToken = useRef(0);

  const bump = useCallback(() => setRev((n) => n + 1), []);

  settleRef.current = () => {
    const world = worldRef.current;
    const runBefore = world.score.run;
    const me = world.score.player;
    const result = evaluateShot(world.score, world.balls, world.tracker, world.mode, world.breakShot);
    world.breakShot = false;
    for (const id of result.respotIds) {
      const ball = world.balls.find((item) => item.id === id);
      if (!ball) continue;
      const spot = findOpenSpot(ball, world.balls, world.table);
      ball.isPocketed = false;
      ball.x = spot.x;
      ball.z = spot.z;
      ball.vx = 0;
      ball.vz = 0;
    }
    if (result.pickupCue) {
      const cue = cueBall(world.balls);
      cue.isPocketed = true;
      cue.vx = 0;
      cue.vz = 0;
    }
    world.score = result.next;
    world.aiGhost = null;
    const completed = result.next.over ? result.next.run : result.next.player !== me ? runBefore : 0;
    if (completed > world.bestRun) {
      world.bestRun = completed;
      writeBestRun(completed);
    }
    if (result.sound === "foul") playFoul();
    if (result.sound === "win") playWin();
    setThinking(false);
    bump();
  };

  const shoot = useCallback(() => {
    const world = worldRef.current;
    const human = world.mode === "hotseat" || world.score.player === 1;
    if (world.phase !== "play" || world.moving || world.score.over || world.score.ballInHand || !human) return;
    const cue = cueBall(world.balls);
    if (cue.isPocketed) return;
    unlockAudio();
    world.breakShot = world.opening;
    strike(cue, world.aimAngle, world.aimPower, world.english, world.follow);
    world.tracker = freshTracker();
    world.moving = true;
    world.opening = false;
    world.aiGhost = null;
    playCue();
    bump();
  }, [bump]);

  shootRef.current = shoot;

  const start = (mode: Mode) => {
    unlockAudio();
    resetRack(worldRef.current, mode);
    setThinking(false);
    bump();
  };

  inputRef.current = ({ x, z, phase }) => {
    const world = worldRef.current;
    if (world.phase !== "play" || world.moving || world.score.over || thinking) return;
    const human = world.mode === "hotseat" || world.score.player === 1;
    if (!human) return;
    unlockAudio();
    if (world.score.ballInHand) {
      const inside = world.score.kitchen ? inKitchen(x, z, world.table) : onCloth(x, z, world.table);
      if (!inside || !spotClear(world.balls, x, z)) {
        if (phase === "down") {
          world.score = {
            ...world.score,
            message: world.score.kitchen
              ? "La blanca tiene que quedar en la cocina, detrás de la línea, sin tocar otra bola."
              : "Pon la blanca en el paño, lejos de las troneras y de las otras bolas.",
          };
          bump();
        }
        return;
      }
      placeCue(world.balls, x, z);
      if (phase === "up") {
        world.score = { ...world.score, ballInHand: false, kitchen: false, message: "Blanca colocada. Ya puedes golpear." };
        bump();
      }
      return;
    }
    const cue = cueBall(world.balls);
    if (cue.isPocketed) return;
    world.aimAngle = Math.atan2(x - cue.x, z - cue.z);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const world = worldRef.current;
      if (event.key === " " && world.phase === "menu") {
        event.preventDefault();
        unlockAudio();
        resetRack(world, "ai");
        setThinking(false);
        bump();
        return;
      }
      if (world.phase !== "play") return;
      const human = world.mode === "hotseat" || world.score.player === 1;
      if (!human || world.moving || world.score.over) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        world.aimAngle += event.key === "ArrowLeft" ? 0.03 : -0.03;
      } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        const next = world.aimPower + (event.key === "ArrowUp" ? 4 : -4);
        world.aimPower = Math.max(8, Math.min(100, next));
        setAimTick((n) => n + 1);
      } else if (event.key === " ") {
        event.preventDefault();
        if (!event.repeat) shootRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bump]);

  useEffect(() => {
    const world = worldRef.current;
    const aiTurn =
      world.phase === "play" && world.mode === "ai" && world.score.player === 2 && !world.moving && !world.score.over;
    if (!aiTurn) {
      setThinking(false);
      return;
    }
    const token = ++aiToken.current;
    setThinking(true);
    const wait = window.setTimeout(() => {
      if (aiToken.current !== token) return;
      const live = worldRef.current;
      if (live.score.ballInHand) {
        const legal = legalTargets(live.balls, live.score);
        const spot = aiCueSpot(live.balls, live.table, live.score.kitchen, legal);
        placeCue(live.balls, spot.x, spot.z);
        live.score = {
          ...live.score,
          ballInHand: false,
          kitchen: false,
          message: live.score.kitchen ? "La IA deja la blanca en la cocina." : "La IA coloca la blanca.",
        };
        setThinking(false);
        bump();
        return;
      }
      const cue = cueBall(live.balls);
      if (cue.isPocketed) return;
      const legal = legalTargets(live.balls, live.score);
      const shot = legal.length ? chooseAiShot(cue, live.balls, live.table, legal, live.difficulty) : null;
      if (shot) {
        live.aimAngle = shot.angle;
        live.aimPower = Math.round(shot.power);
        live.aiGhost = { x: shot.ghostX, z: shot.ghostZ };
      } else if (legal[0]) {
        const safe = safetyAim(cue, legal[0]);
        live.aimAngle = safe.angle;
        live.aimPower = Math.round(safe.power);
      }
      setAimTick((n) => n + 1);
      window.setTimeout(() => {
        if (aiToken.current !== token) return;
        const now = worldRef.current;
        if (now.moving || now.score.over || now.score.player !== 2) return;
        const liveCue = cueBall(now.balls);
        if (liveCue.isPocketed) return;
        now.breakShot = now.opening;
        strike(liveCue, now.aimAngle, now.aimPower, 0, 0);
        now.tracker = freshTracker();
        now.moving = true;
        now.opening = false;
        now.aiGhost = null;
        setThinking(false);
        playCue();
        bump();
      }, 700);
    }, 640);
    return () => {
      window.clearTimeout(wait);
      aiToken.current += 1;
    };
  }, [rev, bump]);

  const world = worldRef.current;
  const score = world.score;
  const human = world.mode === "hotseat" || score.player === 1;
  const canShoot = world.phase === "play" && human && !world.moving && !score.over && !score.ballInHand && !thinking;
  void aimTick;

  const nudge = (delta: number) => {
    if (world.moving || !human || world.phase !== "play" || score.over || score.ballInHand) return;
    world.aimAngle += delta;
  };

  return (
    <div data-frame={rev} className="relative h-dvh overflow-hidden bg-bg text-fg">
      <div className="table-stage absolute inset-0">
        <TableScene
          worldRef={worldRef}
          generation={world.generation}
          inputRef={inputRef}
          settleRef={settleRef}
          shootRef={shootRef}
        />
      </div>

      <aside className="glass-panel absolute inset-x-0 bottom-0 z-10 flex max-h-[46vh] w-full flex-col gap-3 overflow-y-auto border-t border-line/70 px-4 py-3 lg:inset-y-4 lg:right-4 lg:left-auto lg:max-h-none lg:w-80 lg:rounded-xl lg:border">
        <header className="flex items-end justify-between gap-3">
          <div>
            <p className="text-xs tracking-widest text-brass uppercase">Estudio Pekapro</p>
            <h1 className="font-display text-3xl leading-none text-fg">Pekabillar3D</h1>
          </div>
          <p className="text-right text-xs text-muted">
            Mejor racha
            <span className="mt-1 block font-display text-xl text-brass-2">{world.bestRun}</span>
          </p>
        </header>

        {world.phase === "menu" ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm leading-relaxed text-muted">
              Bola 8. La salida no elige grupo: el primero que metas en un tiro legal es el tuyo. Falta, bola en mano en
              todo el paño. La 8 antes de tiempo pierde; si entra limpia en la salida, ganas.
            </p>
            <div className="grid grid-cols-3 gap-2" role="group" aria-label="Dificultad de la IA">
              {DIFFICULTIES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={world.difficulty === item.id}
                  onClick={() => {
                    world.difficulty = item.id;
                    bump();
                  }}
                  className={`h-11 rounded-lg border text-sm ${
                    world.difficulty === item.id ? "border-brass bg-brass text-bg" : "border-line glass-card text-fg"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => start("ai")} className="h-12 rounded-lg bg-brass font-display text-lg text-bg">
              Jugar contra la IA
            </button>
            <button
              type="button"
              onClick={() => start("hotseat")}
              className="h-12 rounded-lg border border-line glass-card font-display text-lg text-fg"
            >
              Dos en la mesa
            </button>
            <p className="text-xs leading-relaxed text-muted">
              Arrastra sobre el paño para apuntar. La potencia va en la barra. El efecto lateral hace que la blanca curve
              mientras gira; la altura es avance o retroceso. Flechas, espacio o clic de la rueda para golpear. Gira la
              rueda para acercarte hasta ver el tapete. Botón derecho para girar la cámara.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2">
              <ScoreCard
                label={playerLabel(1, world.mode)}
                detail={score.groups[1] ? cap(groupName(score.groups[1])) : "Sin grupo"}
                value={score.groups[1] ? String(countLeft(world.balls, score.groups[1])) : "–"}
                caption={score.groups[1] ? "quedan" : "abierta"}
                active={score.player === 1 && !score.over}
              />
              <ScoreCard
                label={playerLabel(2, world.mode)}
                detail={score.groups[2] ? cap(groupName(score.groups[2])) : "Sin grupo"}
                value={score.groups[2] ? String(countLeft(world.balls, score.groups[2])) : "–"}
                caption={score.groups[2] ? "quedan" : "abierta"}
                active={score.player === 2 && !score.over}
              />
            </div>

            <div className="flex items-center justify-between gap-3 rounded-lg border border-line glass-card px-3 py-2">
              <div>
                <p className="text-xs text-muted">Racha</p>
                <p className="font-display text-2xl leading-none">{score.run}</p>
              </div>
              <p className="text-right text-sm">{thinking ? "La IA mira la mesa" : statusLabel(score)}</p>
            </div>

            <BallTray balls={world.balls} score={score} mode={world.mode} />

            <p className={`text-sm leading-snug ${score.message.startsWith("Falta") ? "text-foul" : "text-fg"}`}>
              {thinking ? "La IA está mirando la mesa." : score.message}
            </p>

            <label className="flex flex-col gap-1 text-xs text-muted">
              Potencia {Math.round(world.aimPower)}
              <input
                type="range"
                min={8}
                max={100}
                value={Math.round(world.aimPower)}
                aria-label="Potencia del taco"
                disabled={!human || world.moving || score.over}
                onChange={(event) => {
                  world.aimPower = Number(event.target.value);
                  setAimTick((n) => n + 1);
                }}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Efecto{" "}
              {world.english > 0.08 ? "derecha" : world.english < -0.08 ? "izquierda" : "centro"}
              <input
                type="range"
                min={-100}
                max={100}
                value={Math.round(world.english * 100)}
                aria-label="Efecto lateral"
                disabled={!human || world.moving || score.over}
                onChange={(event) => {
                  world.english = Number(event.target.value) / 100;
                  setAimTick((n) => n + 1);
                }}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Altura{" "}
              {world.follow > 0.08 ? "avance" : world.follow < -0.08 ? "retroceso" : "centro"}
              <input
                type="range"
                min={-100}
                max={100}
                value={Math.round(world.follow * 100)}
                aria-label="Avance o retroceso"
                disabled={!human || world.moving || score.over}
                onChange={(event) => {
                  world.follow = Number(event.target.value) / 100;
                  setAimTick((n) => n + 1);
                }}
              />
            </label>

            <div className="grid grid-cols-[3rem_1fr_3rem] gap-2">
              <button
                type="button"
                aria-label="Girar a la izquierda"
                className="flex h-12 items-center justify-center rounded-lg border border-line glass-card"
                onClick={() => nudge(0.04)}
              >
                <ChevronLeft className="size-5" />
              </button>
              <button
                type="button"
                disabled={!canShoot}
                onClick={shoot}
                className="h-12 rounded-lg bg-brass font-display text-lg text-bg disabled:opacity-40"
              >
                Golpear
              </button>
              <button
                type="button"
                aria-label="Girar a la derecha"
                className="flex h-12 items-center justify-center rounded-lg border border-line glass-card"
                onClick={() => nudge(-0.04)}
              >
                <ChevronRight className="size-5" />
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              {world.opening && human && !world.moving && !score.over && (
                <button
                  type="button"
                  className="h-11 rounded-lg border border-line glass-card px-3 text-sm"
                  onClick={() => {
                    const cue = cueBall(world.balls);
                    cue.isPocketed = true;
                    world.score = {
                      ...world.score,
                      ballInHand: true,
                      kitchen: true,
                      message: "Toca en la cocina, detrás de la línea de cabecera, para dejar la blanca.",
                    };
                    bump();
                  }}
                >
                  Mover la blanca
                </button>
              )}
              {!score.over && (
                <button
                  type="button"
                  className="h-11 rounded-lg border border-line glass-card px-3 text-sm"
                  onClick={() => {
                    if (world.moving) return;
                    const opp = score.player === 1 ? 2 : 1;
                    world.score = {
                      ...world.score,
                      over: true,
                      winner: opp,
                      run: 0,
                      message:
                        world.mode === "ai" && score.player === 1
                          ? `Te rindes. Partida para ${playerLabel(opp, world.mode)}.`
                          : `${playerLabel(score.player, world.mode)} se rinde. Partida para ${playerLabel(opp, world.mode)}.`,
                    };
                    bump();
                  }}
                >
                  Rendirse
                </button>
              )}
              <button
                type="button"
                className="inline-flex h-11 items-center gap-2 rounded-lg border border-line glass-card px-3 text-sm"
                onClick={() => start(world.mode)}
              >
                <RotateCcw className="size-4" />
                Otra partida
              </button>
              <button
                type="button"
                className="h-11 rounded-lg px-3 text-sm text-muted"
                onClick={() => {
                  world.phase = "menu";
                  world.moving = false;
                  setThinking(false);
                  bump();
                }}
              >
                Menú
              </button>
            </div>

            <details className="text-sm text-muted">
              <summary className="cursor-pointer">Últimos tiros</summary>
              <ul className="mt-2 flex flex-col gap-1">
                {score.log.map((line, index) => (
                  <li key={`${rev}-${index}`}>{line}</li>
                ))}
              </ul>
            </details>
          </div>
        )}
      </aside>
    </div>
  );
}

function ScoreCard({
  label,
  detail,
  value,
  caption,
  active,
}: {
  label: string;
  detail: string;
  value: string;
  caption: string;
  active: boolean;
}) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${active ? "border-brass glass-card" : "border-line glass-card"}`}>
      <p className="text-xs text-muted">{label}</p>
      <p className="font-display text-3xl leading-none tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-muted">
        {caption}
        <span className="text-fg"> · {detail}</span>
      </p>
    </div>
  );
}

function BallTray({ balls, score, mode }: { balls: Ball[]; score: ScoreState; mode: Mode }) {
  const solids = balls.filter((ball) => ball.type === "solid").sort((a, b) => a.number - b.number);
  const stripes = balls.filter((ball) => ball.type === "stripe").sort((a, b) => a.number - b.number);
  const eight = balls.find((ball) => ball.type === "eight");
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line glass-card px-3 py-2">
      <BallRow label="Lisas" owner={ownerOf("solid", score, mode)} balls={solids} />
      <BallRow label="Rayadas" owner={ownerOf("stripe", score, mode)} balls={stripes} />
      {eight && (
        <div className="flex items-center gap-2 text-xs text-muted">
          <Pip ball={eight} />
          <span>{eight.isPocketed ? "La 8 está entronerada" : "La 8 sigue en la mesa"}</span>
        </div>
      )}
    </div>
  );
}

function ownerOf(group: Group, score: ScoreState, mode: Mode): string {
  if (score.groups[1] === group) return playerLabel(1, mode);
  if (score.groups[2] === group) return playerLabel(2, mode);
  return "Libre";
}

function BallRow({ label, owner, balls }: { label: string; owner: string; balls: Ball[] }) {
  return (
    <div className="flex items-center gap-2">
      <p className="w-16 shrink-0 text-xs text-muted">
        {label}
        <span className="block text-fg">{owner}</span>
      </p>
      <div className="flex flex-wrap gap-1">
        {balls.map((ball) => (
          <Pip key={ball.id} ball={ball} />
        ))}
      </div>
    </div>
  );
}

function Pip({ ball }: { ball: Ball }) {
  const light = ball.number === 1 || ball.number === 5 || ball.number === 9 || ball.number === 13;
  return (
    <span
      title={ballName(ball)}
      className={`inline-flex size-6 items-center justify-center rounded-full text-[10px] font-semibold ${ball.isPocketed ? "opacity-30" : ""}`}
      style={{
        background: ball.stripe
          ? `linear-gradient(#f4f0e6 18%, ${ball.color} 18% 82%, #f4f0e6 82%)`
          : ball.color,
        color: light && !ball.stripe ? "#1a1208" : "#f7f4ee",
        boxShadow: "inset 0 0 0 1px rgba(243,234,215,0.28)",
      }}
    >
      {ball.stripe || ball.number === 8 ? (
        <span className="flex size-3.5 items-center justify-center rounded-full bg-[#f4f0e6] text-[9px] text-[#161616]">
          {ball.number}
        </span>
      ) : (
        ball.number
      )}
    </span>
  );
}

function cap(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
