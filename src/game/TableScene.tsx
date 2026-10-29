import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import {
  ACESFilmicToneMapping,
  CanvasTexture,
  DoubleSide,
  MOUSE,
  PMREMGenerator,
  Raycaster,
  RepeatWrapping,
  SRGBColorSpace,
  TOUCH,
  Vector2,
  Vector3,
  type Group,
  type Mesh,
  type MeshStandardMaterial,
} from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { aimContact, anyMoving, FIXED_DT, stepSimulation } from "./physics";
import { playHit, playPocket } from "./audio";
import { BALL_R, isBallOn } from "./table";
import type { Ball, World } from "./types";

export interface ClothPointer {
  x: number;
  z: number;
  phase: "down" | "move" | "up";
}

function feltMaps(anisotropy: number): { map: CanvasTexture; bump: CanvasTexture } {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const map = new CanvasTexture(canvas);
  map.wrapS = RepeatWrapping;
  map.wrapT = RepeatWrapping;
  map.repeat.set(7, 14);
  map.colorSpace = SRGBColorSpace;
  map.anisotropy = anisotropy;
  if (ctx) {
    const image = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const nap = Math.sin(x * 0.42 + y * 1.65) * 0.035 + Math.sin(y * 0.9) * 0.02;
        const grain = (Math.random() - 0.5) * 0.045;
        const v = 0.96 + nap + grain;
        const i = (y * size + x) * 4;
        image.data[i] = 11 * v;
        image.data[i + 1] = 92 * v;
        image.data[i + 2] = 48 * v;
        image.data[i + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
    map.needsUpdate = true;
  }

  const bumpCanvas = document.createElement("canvas");
  bumpCanvas.width = 256;
  bumpCanvas.height = 256;
  const bumpCtx = bumpCanvas.getContext("2d");
  const bump = new CanvasTexture(bumpCanvas);
  bump.wrapS = RepeatWrapping;
  bump.wrapT = RepeatWrapping;
  bump.repeat.set(7, 14);
  bump.anisotropy = anisotropy;
  if (bumpCtx) {
    const image = bumpCtx.createImageData(256, 256);
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 256; x++) {
        const nap = (Math.sin(y * 1.8 + x * 0.15) + 1) * 10;
        const n = 132 + nap + (Math.random() - 0.5) * 10;
        const i = (y * 256 + x) * 4;
        image.data[i] = n;
        image.data[i + 1] = n;
        image.data[i + 2] = n;
        image.data[i + 3] = 255;
      }
    }
    bumpCtx.putImageData(image, 0, 0);
    bump.needsUpdate = true;
  }
  return { map, bump };
}

function woodMap(anisotropy: number, dark = false): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  const tex = new CanvasTexture(canvas);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = anisotropy;
  if (!ctx) return tex;
  const grain = ctx.createLinearGradient(0, 0, 256, 0);
  grain.addColorStop(0, dark ? "#1a100c" : "#4a2816");
  grain.addColorStop(0.5, dark ? "#3a2418" : "#7a4630");
  grain.addColorStop(1, dark ? "#1c120e" : "#3e2214");
  ctx.fillStyle = grain;
  ctx.fillRect(0, 0, 256, 512);
  for (let x = 0; x < 256; x += 2) {
    const tone = dark ? 36 + (x % 13) : 90 + (x % 17) * 2;
    ctx.strokeStyle = `rgba(${tone + 28},${Math.floor(tone * 0.42)},${Math.floor(tone * 0.2)},0.22)`;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + Math.sin(x) * 2, 512);
    ctx.stroke();
  }
  for (let i = 0; i < 500; i++) {
    ctx.fillStyle = "rgba(28,12,6,0.12)";
    ctx.fillRect(Math.random() * 256, Math.random() * 512, 1, 6 + Math.random() * 18);
  }
  tex.needsUpdate = true;
  return tex;
}

let contactShade: CanvasTexture | null = null;

function contactShadeTexture(): CanvasTexture | null {
  if (contactShade) return contactShade;
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const fade = ctx.createRadialGradient(64, 64, 6, 64, 64, 62);
  fade.addColorStop(0, "rgba(0,0,0,0.7)");
  fade.addColorStop(0.45, "rgba(0,0,0,0.26)");
  fade.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, 128, 128);
  contactShade = new CanvasTexture(canvas);
  return contactShade;
}

function ballTexture(ball: Ball, anisotropy: number): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = anisotropy;
  if (!ctx) return tex;
  ctx.fillStyle = ball.stripe ? "#f6f3ec" : ball.color;
  ctx.fillRect(0, 0, 512, 256);
  if (ball.stripe) {
    ctx.fillStyle = ball.color;
    ctx.fillRect(0, 78, 512, 100);
  }
  const drawNumber = (cx: number) => {
    ctx.beginPath();
    ctx.fillStyle = "#f7f4ee";
    ctx.arc(cx, 128, 32, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(12,10,8,0.35)";
    ctx.stroke();
    ctx.fillStyle = "#161616";
    ctx.font = "bold 40px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(ball.number), cx, 130);
  };
  drawNumber(128);
  drawNumber(384);
  tex.needsUpdate = true;
  return tex;
}

function badgeTexture(ball: Ball): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  if (!ctx) return tex;
  ctx.clearRect(0, 0, 128, 128);
  ctx.beginPath();
  ctx.arc(64, 64, 58, 0, Math.PI * 2);
  ctx.fillStyle = ball.type === "eight" ? "#141414" : ball.stripe ? "#f6f3ec" : ball.color;
  ctx.fill();
  if (ball.stripe) {
    ctx.beginPath();
    ctx.arc(64, 64, 44, 0, Math.PI * 2);
    ctx.lineWidth = 22;
    ctx.strokeStyle = ball.color;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(64, 64, ball.stripe ? 26 : 34, 0, Math.PI * 2);
  ctx.fillStyle = "#f7f4ee";
  ctx.fill();
  ctx.fillStyle = "#161616";
  ctx.font = "bold 36px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(ball.number), 64, 66);
  tex.needsUpdate = true;
  return tex;
}

const raycaster = new Raycaster();
const pointerNdc = new Vector2();
const rollAxis = new Vector3();

function ClothPointer({
  inputRef,
  shootRef,
}: {
  inputRef: RefObject<(e: ClothPointer) => void>;
  shootRef: RefObject<() => void>;
}) {
  const { camera, gl } = useThree();
  useEffect(() => {
    const el = gl.domElement;
    let dragging = false;

    const hit = (event: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      pointerNdc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointerNdc, camera);
      const origin = raycaster.ray.origin;
      const direction = raycaster.ray.direction;
      if (Math.abs(direction.y) < 0.0001) return null;
      const t = -origin.y / direction.y;
      if (t < 0) return null;
      return { x: origin.x + direction.x * t, z: origin.z + direction.z * t };
    };

    const down = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const point = hit(event);
      if (!point) return;
      dragging = true;
      el.setPointerCapture(event.pointerId);
      inputRef.current?.({ ...point, phase: "down" });
    };
    const move = (event: PointerEvent) => {
      if (!dragging) return;
      const point = hit(event);
      if (point) inputRef.current?.({ ...point, phase: "move" });
    };
    const up = (event: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      const point = hit(event);
      if (point) inputRef.current?.({ ...point, phase: "up" });
    };
    const wheelClick = (event: PointerEvent) => {
      if (event.button !== 1) return;
      event.preventDefault();
      event.stopPropagation();
      shootRef.current();
    };
    const blockAux = (event: MouseEvent) => {
      if (event.button === 1) event.preventDefault();
    };
    const blockMiddle = (event: MouseEvent) => {
      if (event.button !== 1) return;
      event.preventDefault();
      event.stopPropagation();
    };

    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerdown", wheelClick, true);
    el.addEventListener("mousedown", blockMiddle, true);
    el.addEventListener("auxclick", blockAux);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointerdown", wheelClick, true);
      el.removeEventListener("mousedown", blockMiddle, true);
      el.removeEventListener("auxclick", blockAux);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
  }, [camera, gl, inputRef, shootRef]);
  return null;
}

function HallLight() {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  useLayoutEffect(() => {
    const pmrem = new PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const env = pmrem.fromScene(room, 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = 0.62;
    return () => {
      env.dispose();
      pmrem.dispose();
      if (scene.environment === env) scene.environment = null;
      room.traverse((obj) => {
        const mesh = obj as Mesh;
        mesh.geometry?.dispose();
        const material = mesh.material;
        if (Array.isArray(material)) material.forEach((item) => item.dispose());
        else material?.dispose();
      });
    };
  }, [gl, scene]);
  return null;
}

function TableMesh({ worldRef }: { worldRef: RefObject<World> }) {
  const anisotropy = useThree((state) => state.gl.capabilities.getMaxAnisotropy());
  const cloth = useMemo(() => feltMaps(anisotropy), [anisotropy]);
  const wood = useMemo(() => woodMap(anisotropy), [anisotropy]);
  const woodDark = useMemo(() => woodMap(anisotropy, true), [anisotropy]);
  useEffect(
    () => () => {
      cloth.map.dispose();
      cloth.bump.dispose();
      wood.dispose();
      woodDark.dispose();
    },
    [cloth, wood, woodDark],
  );
  const table = worldRef.current.table;
  const { width, length, halfW, halfL, headZ, footZ } = table;
  const thick = 0.075;
  const railH = 0.06;
  const jaw = 0.2;
  const sideGap = 0.15;
  const sideLen = halfL - jaw - sideGap;
  const sideZ = sideGap + sideLen / 2;
  const endLen = width - jaw * 2;
  const sights: Array<[number, number]> = [];
  for (const side of [-1, 1]) {
    for (const z of [-1.2, -0.62, 0.62, 1.2]) sights.push([side * (halfW + thick * 0.15), z]);
    for (const x of [-0.42, 0.42]) sights.push([x, side * (halfL + thick * 0.15)]);
  }

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.64, 0]} receiveShadow>
        <planeGeometry args={[14, 16]} />
        <meshStandardMaterial map={woodDark} color="#3a2a22" roughness={0.78} metalness={0.02} />
      </mesh>
      <mesh position={[0, -0.11, 0]} castShadow receiveShadow>
        <boxGeometry args={[width + 0.42, 0.16, length + 0.42]} />
        <meshPhysicalMaterial map={wood} roughness={0.42} metalness={0.04} clearcoat={0.28} clearcoatRoughness={0.4} />
      </mesh>
      {[
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ].map(([sx, sz]) => (
        <mesh key={`${sx}${sz}`} position={[sx * (halfW + 0.04), -0.38, sz * (halfL + 0.04)]} castShadow>
          <cylinderGeometry args={[0.05, 0.06, 0.46, 16]} />
          <meshStandardMaterial map={woodDark} roughness={0.62} />
        </mesh>
      ))}

      <mesh position={[0, -0.012, 0]} receiveShadow>
        <boxGeometry args={[width, 0.024, length]} />
        <meshStandardMaterial map={cloth.map} bumpMap={cloth.bump} bumpScale={0.0035} color="#d7ffe4" roughness={0.74} metalness={0} />
      </mesh>

      <mesh position={[0, 0.002, headZ]}>
        <boxGeometry args={[width * 0.92, 0.003, 0.008]} />
        <meshBasicMaterial color="#f4f0e6" transparent opacity={0.55} />
      </mesh>
      <mesh position={[0, 0.003, footZ]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.014, 20]} />
        <meshBasicMaterial color="#f4f0e6" transparent opacity={0.5} />
      </mesh>

      {table.pockets.map((pocket) => (
        <group key={pocket.id} position={[pocket.x, 0.004, pocket.z]}>
          <mesh>
            <cylinderGeometry args={[pocket.r * 0.92, pocket.r * 0.78, 0.05, 28]} />
            <meshStandardMaterial color="#050607" roughness={0.4} metalness={0.2} />
          </mesh>
          <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[pocket.r * 0.86, pocket.r * 1.22, 28]} />
            <meshPhysicalMaterial color="#c4923e" metalness={0.92} roughness={0.22} clearcoat={0.4} side={DoubleSide} />
          </mesh>
        </group>
      ))}

      {[
        [-halfW - thick / 2, sideZ],
        [-halfW - thick / 2, -sideZ],
        [halfW + thick / 2, sideZ],
        [halfW + thick / 2, -sideZ],
      ].map(([x, z], i) => (
        <group key={i}>
          <mesh position={[x, railH / 2, z]} castShadow receiveShadow>
            <boxGeometry args={[thick, railH, sideLen]} />
            <meshStandardMaterial color="#187243" roughness={0.58} />
          </mesh>
          <mesh position={[Math.sign(x) * -0.02 + x, 0.026, z]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[0.02, 0.02, sideLen * 0.98, 16]} />
            <meshStandardMaterial color="#1f8a4e" roughness={0.48} />
          </mesh>
          <mesh position={[x + Math.sign(x) * 0.02, railH * 0.78, z]} castShadow>
            <boxGeometry args={[thick * 0.7, railH * 0.36, sideLen]} />
            <meshPhysicalMaterial map={wood} roughness={0.4} metalness={0.04} clearcoat={0.22} clearcoatRoughness={0.45} />
          </mesh>
        </group>
      ))}
      {[halfL + thick / 2, -halfL - thick / 2].map((z) => (
        <group key={z}>
          <mesh position={[0, railH / 2, z]} castShadow receiveShadow>
            <boxGeometry args={[endLen, railH, thick]} />
            <meshStandardMaterial color="#187243" roughness={0.58} />
          </mesh>
          <mesh position={[0, 0.026, z + Math.sign(z) * -0.02]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.02, 0.02, endLen * 0.98, 16]} />
            <meshStandardMaterial color="#1f8a4e" roughness={0.48} />
          </mesh>
          <mesh position={[0, railH * 0.78, z + Math.sign(z) * 0.02]} castShadow>
            <boxGeometry args={[endLen, railH * 0.36, thick * 0.7]} />
            <meshPhysicalMaterial map={wood} roughness={0.4} metalness={0.04} clearcoat={0.22} clearcoatRoughness={0.45} />
          </mesh>
        </group>
      ))}
      {sights.map(([x, z]) => (
        <mesh key={`${x}-${z}`} position={[x, railH + 0.004, z]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.008, 16]} />
          <meshPhysicalMaterial color="#d7b56a" metalness={0.8} roughness={0.32} />
        </mesh>
      ))}
    </group>
  );
}

function BallView({ id, worldRef }: { id: number; worldRef: RefObject<World> }) {
  const anisotropy = useThree((state) => state.gl.capabilities.getMaxAnisotropy());
  const ref = useRef<Mesh>(null);
  const shade = useRef<Mesh>(null);
  const badge = useRef<Mesh>(null);
  const ball = worldRef.current.balls.find((item) => item.id === id);
  const tex = useMemo(() => (ball && ball.number > 0 ? ballTexture(ball, anisotropy) : null), [anisotropy, ball]);
  const badgeTex = useMemo(() => (ball && ball.number > 0 ? badgeTexture(ball) : null), [ball]);
  const shadeTex = useMemo(() => contactShadeTexture(), []);
  useEffect(() => {
    return () => {
      tex?.dispose();
      badgeTex?.dispose();
    };
  }, [tex, badgeTex]);
  useLayoutEffect(() => {
    const live = worldRef.current.balls.find((item) => item.id === id);
    if (!live || !ref.current) return;
    ref.current.position.set(live.x, live.radius, live.z);
    if (shade.current) shade.current.position.set(live.x, 0.004, live.z);
    if (badge.current) badge.current.position.set(live.x, live.radius + 0.001, live.z);
  }, [id, worldRef]);

  useFrame(() => {
    const live = worldRef.current.balls.find((item) => item.id === id);
    const mesh = ref.current;
    if (!live || !mesh) return;
    if (live.isPocketed) {
      mesh.visible = false;
      if (shade.current) shade.current.visible = false;
      if (badge.current) badge.current.visible = false;
      return;
    }
    const dx = live.x - mesh.position.x;
    const dz = live.z - mesh.position.z;
    const dist = Math.hypot(dx, dz);
    mesh.visible = true;
    mesh.position.set(live.x, live.radius, live.z);
    if (dist > 0.0001 && dist < 0.2) {
      rollAxis.set(-dz, 0, dx).normalize();
      mesh.rotateOnWorldAxis(rollAxis, dist / live.radius);
    }
    if (shade.current) {
      shade.current.visible = true;
      shade.current.position.set(live.x, 0.004, live.z);
    }
    if (badge.current) {
      badge.current.visible = true;
      badge.current.position.set(live.x, live.radius + 0.001, live.z);
    }
  });

  if (!ball) return null;
  return (
    <>
      <mesh ref={ref} castShadow>
        <sphereGeometry args={[ball.radius, 48, 32]} />
        <meshPhysicalMaterial
          map={tex ?? undefined}
          color={tex ? "#ffffff" : ball.color}
          roughness={ball.isCue ? 0.04 : 0.1}
          metalness={0}
          clearcoat={1}
          clearcoatRoughness={0.03}
          envMapIntensity={0.55}
        />
      </mesh>
      {badgeTex && (
        <mesh ref={badge} rotation={[-Math.PI / 2, 0, 0]} position={[ball.x, ball.radius + 0.001, ball.z]}>
          <circleGeometry args={[ball.radius * 0.36, 24]} />
          <meshBasicMaterial map={badgeTex} transparent depthWrite={false} />
        </mesh>
      )}
      {shadeTex && (
        <mesh ref={shade} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[ball.radius * 1.7, 20]} />
          <meshBasicMaterial map={shadeTex} transparent depthWrite={false} />
        </mesh>
      )}
    </>
  );
}

function CueAndGuides({ worldRef }: { worldRef: RefObject<World> }) {
  const cue = useRef<Group>(null);
  const shaft = useRef<Mesh>(null);
  const ferrule = useRef<Mesh>(null);
  const tip = useRef<Mesh>(null);
  const aim = useRef<Mesh>(null);
  const ghost = useRef<Mesh>(null);
  const length = 1.22;

  useFrame(() => {
    const world = worldRef.current;
    const ball = world.balls.find((item) => item.isCue);
    const stick = cue.current;
    if (!stick || !ball) return;
    const showStick = !ball.isPocketed && !world.moving;
    stick.visible = showStick;
    if (showStick) {
      const pull = ball.radius + 0.045 + (world.aimPower / 100) * 0.42;
      stick.position.set(ball.x, ball.radius, ball.z);
      stick.rotation.set(0.08, world.aimAngle, 0);
      if (shaft.current) shaft.current.position.z = -(pull + length / 2);
      if (ferrule.current) ferrule.current.position.z = -pull + 0.02;
      if (tip.current) tip.current.position.z = -pull + 0.004;
    }

    const human = world.mode === "hotseat" || world.score.player === 1;
    const showAim =
      world.phase === "play" && human && !world.moving && !world.score.over && !world.score.ballInHand && !ball.isPocketed;
    if (aim.current) {
      const len = 0.22 + (world.aimPower / 100) * 0.95;
      aim.current.visible = showAim;
      if (showAim) {
        const dx = Math.sin(world.aimAngle);
        const dz = Math.cos(world.aimAngle);
        aim.current.position.set(ball.x + dx * (ball.radius + len / 2), 0.008, ball.z + dz * (ball.radius + len / 2));
        aim.current.rotation.y = world.aimAngle;
        aim.current.scale.set(1, 1, len);
      }
    }
    if (ghost.current) {
      const standard = ghost.current.material as MeshStandardMaterial;
      if (showAim) {
        const contact = aimContact(ball, world.balls, world.aimAngle);
        if (contact) {
          ghost.current.visible = true;
          ghost.current.position.set(contact.x, ball.radius, contact.z);
          standard.color.set(isBallOn(contact.ball, world.score) ? "#d4a656" : "#e06a58");
        } else ghost.current.visible = false;
      } else if (world.aiGhost) {
        ghost.current.visible = true;
        ghost.current.position.set(world.aiGhost.x, ball.radius, world.aiGhost.z);
        standard.color.set("#9fd8c8");
      } else ghost.current.visible = false;
    }
  });

  return (
    <>
      <group ref={cue}>
        <mesh ref={shaft} rotation={[Math.PI / 2, 0, 0]} position={[0, 0.035, -0.8]}>
          <cylinderGeometry args={[0.0065, 0.013, length, 20]} />
          <meshPhysicalMaterial color="#e2c08a" roughness={0.34} clearcoat={0.45} clearcoatRoughness={0.28} />
        </mesh>
        <mesh ref={ferrule} rotation={[Math.PI / 2, 0, 0]} position={[0, 0.035, -0.16]}>
          <cylinderGeometry args={[0.0064, 0.0064, 0.034, 16]} />
          <meshStandardMaterial color="#f6f3ec" roughness={0.32} />
        </mesh>
        <mesh ref={tip} position={[0, 0.035, -0.16]}>
          <sphereGeometry args={[0.007, 12, 10]} />
          <meshStandardMaterial color="#2f6d4a" roughness={0.62} />
        </mesh>
      </group>
      <mesh ref={aim} position={[0, 0.008, 0]}>
        <boxGeometry args={[0.014, 0.004, 1]} />
        <meshBasicMaterial color="#f0d7a0" transparent opacity={0.9} />
      </mesh>
      <mesh ref={ghost}>
        <sphereGeometry args={[BALL_R, 20, 14]} />
        <meshStandardMaterial color="#d4a656" transparent opacity={0.33} />
      </mesh>
    </>
  );
}

function Markers({ worldRef }: { worldRef: RefObject<World> }) {
  const refs = useRef<Array<Mesh | null>>([]);
  useFrame(() => {
    const world = worldRef.current;
    for (const mesh of refs.current) {
      if (!mesh) continue;
      const id = mesh.userData.ballId as number;
      const ball = world.balls.find((item) => item.id === id);
      if (!ball || ball.isPocketed || world.moving || world.phase !== "play") {
        mesh.visible = false;
        continue;
      }
      mesh.visible = world.phase === "play" && !world.opening && !world.moving && isBallOn(ball, world.score);
      mesh.position.set(ball.x, 0.007, ball.z);
    }
  });
  const ids = worldRef.current.balls.filter((ball) => !ball.isCue).map((ball) => ball.id);
  return (
    <>
      {ids.map((id, index) => (
        <mesh
          key={id}
          ref={(node) => {
            refs.current[index] = node;
            if (node) node.userData.ballId = id;
          }}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <ringGeometry args={[BALL_R * 1.2, BALL_R * 1.55, 24]} />
          <meshBasicMaterial color="#d4a656" transparent opacity={0.9} side={DoubleSide} />
        </mesh>
      ))}
    </>
  );
}

function Simulator({
  worldRef,
  settleRef,
}: {
  worldRef: RefObject<World>;
  settleRef: RefObject<() => void>;
}) {
  const acc = useRef(0);
  const heard = useRef({ pocket: false });
  const impacts = useRef<number[]>([]);
  useFrame((_, delta) => {
    const world = worldRef.current;
    if (!world?.moving) {
      acc.current = 0;
      heard.current.pocket = false;
      return;
    }
    acc.current += Math.min(delta, 0.05);
    let steps = 0;
    const hits = impacts.current;
    hits.length = 0;
    while (acc.current >= FIXED_DT && steps < 8) {
      acc.current -= FIXED_DT;
      stepSimulation(world.balls, world.table, FIXED_DT, world.tracker, hits);
      steps++;
    }
    if (hits.length > 0) {
      hits.sort((a, b) => b - a);
      const loudest = Math.min(4, hits.length);
      for (let i = 0; i < loudest; i++) playHit(hits[i]);
    }
    if ((world.tracker.pocketed.length > 0 || world.tracker.cuePotted) && !heard.current.pocket) {
      heard.current.pocket = true;
      playPocket();
    }
    if (!anyMoving(world.balls)) {
      world.moving = false;
      acc.current = 0;
      settleRef.current();
    }
  });
  return null;
}

function LiveTable({
  worldRef,
  generation,
  inputRef,
  settleRef,
  shootRef,
}: {
  worldRef: RefObject<World>;
  generation: number;
  inputRef: RefObject<(e: ClothPointer) => void>;
  settleRef: RefObject<() => void>;
  shootRef: RefObject<() => void>;
}) {
  const ids = worldRef.current.balls.map((ball) => ball.id);
  return (
    <>
      <color attach="background" args={["#100e0c"]} />
      <HallLight />
      <hemisphereLight args={["#fff8ee", "#14281e", 0.18]} />
      <ambientLight intensity={0.035} />
      <directionalLight
        position={[0.6, 6.8, 0.2]}
        intensity={2.05}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-bias={-0.00018}
        shadow-normalBias={0.02}
        shadow-camera-near={2}
        shadow-camera-far={16}
        shadow-camera-left={-2.3}
        shadow-camera-right={2.3}
        shadow-camera-top={2.7}
        shadow-camera-bottom={-2.7}
      />
      <directionalLight position={[-2.8, 3.2, -1.6]} intensity={0.28} color="#d7e4ff" />
      <spotLight position={[0, 3.8, 0.05]} angle={0.95} penumbra={0.85} intensity={16} distance={9} decay={2} color="#fff4e2" />
      <TableMesh worldRef={worldRef} />
      <group key={generation}>
        {ids.map((id) => (
          <BallView key={id} id={id} worldRef={worldRef} />
        ))}
      </group>
      <CueAndGuides worldRef={worldRef} />
      <Markers key={`m-${generation}`} worldRef={worldRef} />
      <ClothPointer inputRef={inputRef} shootRef={shootRef} />
      <Simulator worldRef={worldRef} settleRef={settleRef} />
      <OrbitControls
        enablePan={false}
        enableDamping
        dampingFactor={0.08}
        zoomToCursor
        zoomSpeed={1.15}
        minPolarAngle={0.08}
        maxPolarAngle={1.22}
        minDistance={0.12}
        maxDistance={6.2}
        target={[0, 0, -0.12]}
        mouseButtons={{ LEFT: MOUSE.PAN, MIDDLE: MOUSE.PAN, RIGHT: MOUSE.ROTATE }}
        touches={{ ONE: TOUCH.PAN, TWO: TOUCH.DOLLY_ROTATE }}
      />
    </>
  );
}

export function TableScene({
  worldRef,
  generation,
  inputRef,
  settleRef,
  shootRef,
}: {
  worldRef: RefObject<World>;
  generation: number;
  inputRef: RefObject<(e: ClothPointer) => void>;
  settleRef: RefObject<() => void>;
  shootRef: RefObject<() => void>;
}) {
  return (
    <Canvas
      className="h-full w-full"
      shadows
      dpr={[1, 2]}
      camera={{ position: [0.15, 2.42, 2.28], fov: 38, near: 0.02, far: 40 }}
      gl={{ antialias: true }}
      onCreated={({ gl, camera }) => {
        gl.toneMapping = ACESFilmicToneMapping;
        gl.toneMappingExposure = 0.98;
        camera.lookAt(0, 0, -0.15);
      }}
    >
      <LiveTable worldRef={worldRef} generation={generation} inputRef={inputRef} settleRef={settleRef} shootRef={shootRef} />
    </Canvas>
  );
}
