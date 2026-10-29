import { ballName, groupName, otherGroup, playerLabel } from "./table";
import type { Ball, Group, Mode, PlayerId, ScoreState, ShotResult, Tracker } from "./types";

export function initialScore(): ScoreState {
  return {
    groups: { 1: null, 2: null },
    open: true,
    onEight: false,
    player: 1,
    ballInHand: false,
    kitchen: false,
    over: false,
    winner: null,
    message: "Salida. Puedes mover la blanca detrás de la línea, o romper el triángulo.",
    log: ["Bola 8. La mesa queda abierta después de la salida."],
    run: 0,
  };
}

function clone(score: ScoreState): ScoreState {
  return { ...score, log: score.log.slice(), groups: { ...score.groups } };
}

function pushLog(score: ScoreState, line: string): void {
  score.log = [line, ...score.log].slice(0, 14);
}

function turnLine(player: PlayerId, mode: Mode): string {
  if (mode === "ai" && player === 1) return "Tu turno.";
  return `Turno de ${playerLabel(player, mode)}.`;
}

function winLine(player: PlayerId, mode: Mode): string {
  if (mode === "ai" && player === 1) return "Ganas la partida.";
  if (mode === "ai" && player === 2) return "Gana la IA.";
  return `Partida para ${playerLabel(player, mode)}.`;
}

function hint(score: ScoreState): string {
  if (score.open || !score.groups[score.player]) return "Mesa abierta: lisa o rayada, nunca la 8.";
  if (score.onEight) return "Queda la 8.";
  return score.groups[score.player] === "solid" ? "Juega las lisas." : "Juega las rayadas.";
}

function refreshOnEight(score: ScoreState, balls: Ball[]): void {
  const group = score.groups[score.player];
  score.onEight = !score.open && group != null && !balls.some((ball) => !ball.isPocketed && ball.type === group);
}

function groupWasOnTable(balls: Ball[], group: Group, pocketedNow: Ball[]): boolean {
  const just = new Set(pocketedNow.map((ball) => ball.id));
  return balls.some((ball) => ball.type === group && (!ball.isPocketed || just.has(ball.id)));
}

function shootingEight(score: ScoreState, balls: Ball[], pocketed: Ball[]): boolean {
  const group = score.groups[score.player];
  if (score.open || !group) return false;
  return !groupWasOnTable(balls, group, pocketed);
}

function legalFirst(score: ScoreState, ball: Ball, onEight: boolean): boolean {
  if (ball.isCue || ball.type === "cue") return false;
  if (score.open || !score.groups[score.player]) return ball.type === "solid" || ball.type === "stripe";
  if (onEight) return ball.type === "eight";
  return ball.type === score.groups[score.player];
}

export function evaluateShot(
  score: ScoreState,
  balls: Ball[],
  tracker: Tracker,
  mode: Mode,
  wasBreak: boolean,
): ShotResult {
  const s = clone(score);
  const me = s.player;
  const opp: PlayerId = me === 1 ? 2 : 1;
  const who = (player: PlayerId) => playerLabel(player, mode);
  const pocketed = tracker.pocketed.filter((ball) => !ball.isCue);
  const eight = pocketed.find((ball) => ball.type === "eight") ?? null;
  const objects = pocketed.filter((ball) => ball.type === "solid" || ball.type === "stripe");
  const onEight = shootingEight(s, balls, pocketed);
  const first = tracker.first;

  let foul = false;
  let reason = "";
  if (tracker.cuePotted) {
    foul = true;
    reason = "La blanca se ha colado.";
  } else if (!first) {
    foul = true;
    reason = "La blanca no ha tocado ninguna bola.";
  } else if (!legalFirst(s, first, onEight)) {
    foul = true;
    reason = `Primer contacto ilegal (${ballName(first)}).`;
  } else if (pocketed.length === 0 && !tracker.railAfterContact) {
    foul = true;
    reason = "Ninguna bola ha ido a banda.";
  }

  const handoff = (message: string, sound: ShotResult["sound"], respotIds: number[] = []): ShotResult => {
    s.player = opp;
    s.run = 0;
    s.ballInHand = true;
    s.kitchen = false;
    refreshOnEight(s, balls);
    s.message = message;
    return { next: s, respotIds, pickupCue: true, sound };
  };

  if (eight && wasBreak) {
    if (foul) {
      pushLog(s, `${who(me)} · La 8 en la salida, con falta. Se recoloca.`);
      return handoff(
        `Falta en la salida y cae la 8. Se recoloca. Bola en mano. ${turnLine(opp, mode)}`,
        "foul",
        [eight.id],
      );
    }
    s.over = true;
    s.winner = me;
    s.run += 1;
    s.ballInHand = false;
    s.kitchen = false;
    s.message = `La 8 entra limpia en la salida. ${winLine(me, mode)}`;
    pushLog(s, `${who(me)} · Bola 8 en la salida. Gana.`);
    return { next: s, respotIds: [], pickupCue: false, sound: "win" };
  }

  if (eight) {
    const clean = onEight && !foul;
    s.over = true;
    s.winner = clean ? me : opp;
    s.run = clean ? s.run + 1 : 0;
    s.ballInHand = false;
    s.kitchen = false;
    s.onEight = false;
    if (clean) {
      s.message = `La 8. ${winLine(me, mode)}`;
      pushLog(s, `${who(me)} · La 8. Gana la partida.`);
    } else if (foul) {
      s.message = `${reason} Y cae la 8: ${winLine(opp, mode)}`;
      pushLog(s, `${who(me)} · La 8 con falta. Gana ${who(opp)}.`);
    } else {
      s.message = `La 8 cae antes de tiempo. ${winLine(opp, mode)}`;
      pushLog(s, `${who(me)} · La 8 antes de hora. Gana ${who(opp)}.`);
    }
    return { next: s, respotIds: [], pickupCue: false, sound: clean ? "win" : "foul" };
  }

  if (foul) {
    pushLog(s, `${who(me)} · Falta. ${reason}`);
    const mine = mode === "ai" && me === 1 ? "Falta tuya" : `Falta de ${who(me)}`;
    return handoff(`${mine}: ${reason} Bola en mano. ${turnLine(opp, mode)}`, "foul");
  }

  let assigned: Group | null = null;
  if (!wasBreak && s.open && objects.length > 0) {
    const group = objects[0]?.type === "stripe" ? "stripe" : "solid";
    assigned = group;
    s.groups[me] = group;
    s.groups[opp] = otherGroup(group);
    s.open = false;
  }

  const own = s.groups[me];
  const kept = wasBreak ? objects : objects.filter((ball) => ball.type === own);

  if (kept.length > 0) {
    s.run += kept.length;
    s.ballInHand = false;
    s.kitchen = false;
    refreshOnEight(s, balls);
    const extra = s.onEight ? " Queda la 8." : "";
    if (wasBreak) {
      const n = kept.length;
      s.message = `Salida con ${n === 1 ? "una bola" : `${n} bolas`}. La mesa sigue abierta.${extra}`;
      pushLog(s, `${who(me)} · Salida, ${n} ${n === 1 ? "bola" : "bolas"}. Mesa abierta.`);
    } else if (assigned) {
      const mine = mode === "ai" && me === 1;
      s.message = mine
        ? `Te quedas las ${groupName(assigned)}.${extra}`
        : `${cap(groupName(assigned))} para ${who(me)}.${extra}`;
      pushLog(s, `${who(me)} · Se queda las ${groupName(assigned)}.`);
    } else {
      const n = kept.length;
      s.message = `${n === 1 ? "Bola metida" : `${n} bolas metidas`}. Sigues en la mesa.${extra}`;
      pushLog(s, `${who(me)} · Mete ${n}. Racha ${s.run}.`);
    }
    return { next: s, respotIds: [], pickupCue: false, sound: "pot" };
  }

  s.run = 0;
  s.player = opp;
  s.ballInHand = false;
  s.kitchen = false;
  refreshOnEight(s, balls);
  s.message = wasBreak
    ? `Salida sin meter. ${turnLine(opp, mode)} ${hint(s)}`
    : `${turnLine(opp, mode)} ${hint(s)}`;
  pushLog(s, `${who(me)} · Sin meter. ${turnLine(opp, mode)}`);
  return { next: s, respotIds: [], pickupCue: false, sound: "miss" };
}

function cap(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function statusLabel(score: ScoreState): string {
  if (score.over) return "Cerrada";
  if (score.open) return "Mesa abierta";
  if (score.onEight) return "La 8";
  const group = score.groups[score.player];
  if (group === "solid") return "Lisas";
  if (group === "stripe") return "Rayadas";
  return "Mesa abierta";
}
