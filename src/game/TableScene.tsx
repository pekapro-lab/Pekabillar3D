import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import {
  ACESFilmicToneMapping,
  CanvasTexture,
  CubeCamera,
  DoubleSide,
  LinearMipmapLinearFilter,
  MOUSE,
  PMREMGenerator,
  Raycaster,
  RepeatWrapping,
  SRGBColorSpace,
  TOUCH,
  Vector2,
  Vector3,
  WebGLCubeRenderTarget,
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

function feltMaps(anisotropy: number, rgb: [number, number, number]): { map: CanvasTexture; bump: CanvasTexture } {
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
        image.data[i] = rgb[0] * v;
        image.data[i + 1] = rgb[1] * v;
        image.data[i + 2] = rgb[2] * v;
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
  const w = 512;
  const h = 512;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  const tex = new CanvasTexture(canvas);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = anisotropy;
  if (!ctx) return tex;
  const base = ctx.createLinearGradient(0, 0, w, 0);
  if (dark) {
    base.addColorStop(0, "#24140e");
    base.addColorStop(0.5, "#3a2218");
    base.addColorStop(1, "#1c100c");
  } else {
    base.addColorStop(0, "#5a2d16");
    base.addColorStop(0.28, "#8d4e2a");
    base.addColorStop(0.55, "#6a3820");
    base.addColorStop(0.8, "#4e2814");
    base.addColorStop(1, "#7a4124");
  }
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x++) {
    const wave = Math.sin(x * 0.018) * 10 + Math.sin(x * 0.006) * 18;
    const pore = dark ? 22 + (x % 19) : 55 + (x % 31);
    ctx.strokeStyle = `rgba(${pore + 42},${Math.floor(pore * 0.36)},${Math.floor(pore * 0.14)},${0.05 + (x % 7) * 0.012})`;
    ctx.lineWidth = x % 11 === 0 ? 1.6 : 1;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.bezierCurveTo(x + wave, h * 0.3, x - wave * 0.45, h * 0.68, x + Math.sin(x * 0.04) * 4, h);
    ctx.stroke();
  }
  for (let i = 0; i < 2200; i++) {
    ctx.fillStyle = "rgba(28,10,4,0.2)";
    ctx.fillRect(Math.random() * w, Math.random() * h, 1, 4 + Math.random() * 22);
  }
  ctx.globalAlpha = 0.05;
  ctx.strokeStyle = dark ? "#6a4030" : "#e0a070";
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    ctx.moveTo(Math.random() * w, 0);
    ctx.quadraticCurveTo(Math.random() * w, h * 0.5, Math.random() * w, h);
    ctx.stroke();
  }
  tex.needsUpdate = true;
  return tex;
}

function leatherMap(anisotropy: number): CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const tex = new CanvasTexture(canvas);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = anisotropy;
  if (!ctx) return tex;
  ctx.fillStyle = "#3a241c";
  ctx.fillRect(0, 0, size, size);
  const image = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < image.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 28;
    image.data[i] = Math.min(255, Math.max(0, image.data[i] + n));
    image.data[i + 1] = Math.min(255, Math.max(0, image.data[i + 1] + n * 0.55));
    image.data[i + 2] = Math.min(255, Math.max(0, image.data[i + 2] + n * 0.35));
  }
  ctx.putImageData(image, 0, 0);
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
  fade.addColorStop(0, "rgba(0,0,0,0.35)");
  fade.addColorStop(0.45, "rgba(0,0,0,0.12)");
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
const upAxis = new Vector3(0, 1, 0);

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

function HallLight({ worldRef }: { worldRef: RefObject<World> }) {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const cube = useRef<CubeCamera | null>(null);
  const tick = useRef(0);
  const lastCam = useRef(new Vector3(99, 99, 99));
  useLayoutEffect(() => {
    const pmrem = new PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const env = pmrem.fromScene(room, 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = 0.7;
    const target = new WebGLCubeRenderTarget(128);
    target.texture.minFilter = LinearMipmapLinearFilter;
    target.texture.generateMipmaps = true;
    cube.current = new CubeCamera(0.08, 28, target);
    gl.shadowMap.autoUpdate = false;
    gl.shadowMap.needsUpdate = true;
    return () => {
      env.dispose();
      pmrem.dispose();
      target.dispose();
      cube.current = null;
      gl.shadowMap.autoUpdate = true;
      if (scene.environment === env || scene.environment === target.texture) scene.environment = null;
      room.traverse((obj) => {
        const mesh = obj as Mesh;
        mesh.geometry?.dispose();
        const material = mesh.material;
        if (Array.isArray(material)) material.forEach((item) => item.dispose());
        else material?.dispose();
      });
    };
  }, [gl, scene]);
  useFrame(() => {
    const moving = worldRef.current.moving;
    if (moving) gl.shadowMap.needsUpdate = true;
    const cam = cube.current;
    if (!cam) return;
    tick.current += 1;
    const interval = moving ? 6 : 24;
    if (tick.current % interval !== 0) return;
    const camMoved = camera.position.distanceToSquared(lastCam.current) > 0.0008;
    if (!moving && !camMoved && scene.environment === cam.renderTarget.texture) return;
    lastCam.current.copy(camera.position);
    cam.position.set(0, 0.46, -0.05);
    cam.update(gl, scene);
    if (scene.environment !== cam.renderTarget.texture) scene.environment = cam.renderTarget.texture;
    scene.environmentIntensity = 0.92;
  });
  return null;
}

const CLOTHS = {
  green: { rgb: [11, 92, 48] as [number, number, number], tint: "#d7ffe4", rail: "#187243", nose: "#1f8a4e" },
  red: { rgb: [128, 28, 34] as [number, number, number], tint: "#ffe0dc", rail: "#8c2832", nose: "#b03842" },
  blue: { rgb: [20, 48, 122] as [number, number, number], tint: "#dce6ff", rail: "#1b438c", nose: "#2858ae" },
};

function TableMesh({ worldRef }: { worldRef: RefObject<World> }) {
  const anisotropy = useThree((state) => state.gl.capabilities.getMaxAnisotropy());
  const felt = CLOTHS[worldRef.current.cloth];
  const cloth = useMemo(() => feltMaps(anisotropy, felt.rgb), [anisotropy, felt]);
  const wood = useMemo(() => woodMap(anisotropy), [anisotropy]);
  const woodDark = useMemo(() => woodMap(anisotropy, true), [anisotropy]);
  const leather = useMemo(() => leatherMap(anisotropy), [anisotropy]);
  useEffect(
    () => () => {
      cloth.map.dispose();
      cloth.bump.dispose();
      wood.dispose();
      woodDark.dispose();
      leather.dispose();
    },
    [cloth, wood, woodDark, leather],
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
        <meshStandardMaterial map={wood} roughness={0.5} metalness={0.04} envMapIntensity={0.55} />
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
        <meshStandardMaterial map={cloth.map} bumpMap={cloth.bump} bumpScale={0.0035} color={felt.tint} roughness={0.74} metalness={0} />
      </mesh>

      <mesh position={[0, 0.002, headZ]}>
        <boxGeometry args={[width * 0.92, 0.003, 0.008]} />
        <meshBasicMaterial color="#f4f0e6" transparent opacity={0.55} />
      </mesh>
      <mesh position={[0, 0.003, footZ]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.014, 20]} />
        <meshBasicMaterial color="#f4f0e6" transparent opacity={0.5} />
      </mesh>

      {table.pockets.map((pocket) => {
        const side = Math.abs(pocket.z) < 0.05;
        const ox = Math.sign(pocket.x) * 0.03;
        const oz = side ? 0 : Math.sign(pocket.z) * 0.03;
        const mouth = pocket.r * (side ? 0.78 : 0.9);
        return (
          <group key={pocket.id} position={[pocket.x + ox, 0, pocket.z + oz]} scale={side ? [1, 1, 1.28] : [1, 1, 1]}>
            <mesh position={[0, -0.05, 0]}>
              <cylinderGeometry args={[mouth * 0.92, mouth * 0.5, 0.12, 28]} />
              <meshStandardMaterial color="#050403" roughness={0.95} />
            </mesh>
            <mesh position={[0, -0.12, 0]}>
              <coneGeometry args={[mouth * 0.95, 0.11, 16, 1, true]} />
              <meshStandardMaterial map={leather} color="#241610" roughness={0.92} side={DoubleSide} />
            </mesh>
            <mesh position={[0, 0.016, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <torusGeometry args={[mouth * 0.95, 0.022, 12, 32]} />
              <meshStandardMaterial map={leather} color="#8a4e36" roughness={0.74} />
            </mesh>
            <mesh position={[0, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[mouth * 1.05, mouth * 1.42, 32]} />
              <meshStandardMaterial map={leather} color="#6e3b2a" roughness={0.86} side={DoubleSide} />
            </mesh>
          </group>
        );
      })}

      {[
        [-halfW - thick / 2, sideZ],
        [-halfW - thick / 2, -sideZ],
        [halfW + thick / 2, sideZ],
        [halfW + thick / 2, -sideZ],
      ].map(([x, z], i) => (
        <group key={i}>
          <mesh position={[x, railH / 2, z]} castShadow receiveShadow>
            <boxGeometry args={[thick, railH, sideLen]} />
            <meshStandardMaterial color={felt.rail} roughness={0.58} />
          </mesh>
          <mesh position={[Math.sign(x) * -0.02 + x, 0.026, z]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[0.02, 0.02, sideLen * 0.98, 16]} />
            <meshStandardMaterial color={felt.nose} roughness={0.48} />
          </mesh>
          <mesh position={[x + Math.sign(x) * 0.02, railH * 0.78, z]} castShadow>
            <boxGeometry args={[thick * 0.7, railH * 0.36, sideLen]} />
            <meshStandardMaterial map={wood} roughness={0.46} metalness={0.05} envMapIntensity={0.6} />
          </mesh>
        </group>
      ))}
      {[halfL + thick / 2, -halfL - thick / 2].map((z) => (
        <group key={z}>
          <mesh position={[0, railH / 2, z]} castShadow receiveShadow>
            <boxGeometry args={[endLen, railH, thick]} />
            <meshStandardMaterial color={felt.rail} roughness={0.58} />
          </mesh>
          <mesh position={[0, 0.026, z + Math.sign(z) * -0.02]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.02, 0.02, endLen * 0.98, 16]} />
            <meshStandardMaterial color={felt.nose} roughness={0.48} />
          </mesh>
          <mesh position={[0, railH * 0.78, z + Math.sign(z) * 0.02]} castShadow>
            <boxGeometry args={[endLen, railH * 0.36, thick * 0.7]} />
            <meshStandardMaterial map={wood} roughness={0.46} metalness={0.05} envMapIntensity={0.6} />
          </mesh>
        </group>
      ))}
      {sights.map(([x, z]) => (
        <mesh key={`${x}-${z}`} position={[x, railH + 0.003, z]} rotation={[-Math.PI / 2, 0, Math.PI / 4]}>
          <planeGeometry args={[0.016, 0.016]} />
          <meshStandardMaterial color="#f4ead4" roughness={0.42} metalness={0} />
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
  }, [id, worldRef]);

  useFrame((_, delta) => {
    const live = worldRef.current.balls.find((item) => item.id === id);
    const mesh = ref.current;
    if (!live || !mesh) return;
    if (live.isPocketed) {
      mesh.visible = false;
      if (shade.current) shade.current.visible = false;
      if (badge.current) badge.current.visible = false;
      return;
    }
    const step = Math.min(delta, 0.05);
    const travel = Math.hypot(live.vx, live.vz);
    mesh.visible = true;
    mesh.position.set(live.x, live.radius, live.z);
    if (travel > 0.03) {
      rollAxis.set(live.vz, 0, -live.vx).normalize();
      mesh.rotateOnWorldAxis(rollAxis, (travel * step) / live.radius);
    }
    if (live.isCue && Math.abs(live.side) > 0.05) {
      mesh.rotateOnWorldAxis(upAxis, (-live.side / live.radius) * step);
    }
    if (shade.current) {
      shade.current.visible = true;
      shade.current.position.set(live.x, 0.004, live.z);
    }
    if (badge.current) badge.current.visible = true;
  });

  if (!ball) return null;
  return (
    <>
      <mesh ref={ref} castShadow>
        <sphereGeometry args={[ball.radius, 32, 20]} />
        <meshPhysicalMaterial
          map={tex ?? undefined}
          color={tex ? "#ffffff" : ball.color}
          roughness={ball.isCue ? 0.04 : 0.1}
          metalness={0}
          clearcoat={1}
          clearcoatRoughness={0.04}
          envMapIntensity={1.25}
        />
        {badgeTex && (
          <mesh ref={badge} position={[0, ball.radius + 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[ball.radius * 0.36, 24]} />
            <meshBasicMaterial map={badgeTex} transparent depthWrite={false} polygonOffset polygonOffsetFactor={-2} />
          </mesh>
        )}
      </mesh>
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
  const hitSpot = useRef<Mesh>(null);
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
      const side = world.english * ball.radius * 0.62;
      const rise = world.follow * ball.radius * 0.48;
      const px = Math.cos(world.aimAngle);
      const pz = -Math.sin(world.aimAngle);
      stick.position.set(ball.x + px * side, ball.radius + rise, ball.z + pz * side);
      stick.rotation.set(0.08 - world.follow * 0.06, world.aimAngle, world.english * 0.08);
      if (shaft.current) shaft.current.position.z = -(pull + length / 2);
      if (ferrule.current) ferrule.current.position.z = -pull + 0.02;
      if (tip.current) tip.current.position.z = -pull + 0.004;
      if (hitSpot.current) {
        hitSpot.current.visible = true;
        hitSpot.current.position.set(ball.x + px * side, ball.radius + ball.radius * 0.15 + rise, ball.z + pz * side);
      }
    } else if (hitSpot.current) hitSpot.current.visible = false;

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
      <mesh ref={hitSpot} visible={false}>
        <sphereGeometry args={[0.008, 10, 8]} />
        <meshBasicMaterial color="#f0d7a0" />
      </mesh>
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
      <HallLight worldRef={worldRef} />
      <hemisphereLight args={["#fff8ee", "#14281e", 0.18]} />
      <ambientLight intensity={0.035} />
      <directionalLight
        position={[2.6, 4.6, 1.7]}
        intensity={2.35}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-bias={-0.0003}
        shadow-normalBias={0.028}
        shadow-radius={2.5}
        shadow-camera-near={1}
        shadow-camera-far={16}
        shadow-camera-left={-3.1}
        shadow-camera-right={3.1}
        shadow-camera-top={3.4}
        shadow-camera-bottom={-3.4}
      >
        <object3D attach="target" position={[0, 0, 0]} />
      </directionalLight>
      <directionalLight position={[-2.8, 3.2, -1.6]} intensity={0.22} color="#d7e4ff" />
      <spotLight
        position={[0.2, 3.5, 0.35]}
        angle={0.78}
        penumbra={0.55}
        intensity={18}
        distance={9}
        decay={2}
        color="#fff4e2"
      />
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
      dpr={[1, 1.5]}
      camera={{ position: [0.15, 2.42, 2.28], fov: 38, near: 0.02, far: 40 }}
      gl={{ antialias: true, powerPreference: "high-performance", stencil: false }}
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
