import { useEffect, useRef } from "react";

type Point = { x: number; y: number };
type Node = Point & { label: string };

const CYCLE_SECONDS = 18;
const MOBILE_FRAME_MS = 1000 / 12;
const DESKTOP_FRAME_MS = 1000 / 28;

const AMBIENT_CHARS = [" ", " ", ".", ":", "-", "~"];
const SIGNAL_CHARS = ["<", ">", "/", "\\", "{", "}", "(", ")", ";", "=", "+", "*"];
const NODE_CHARS = ["@", "#", "%", "*", "+", "="];

const sourceNodes: Node[] = [
  { x: 0.12, y: 0.22, label: "TASK" },
  { x: 0.14, y: 0.7, label: "INPUT" },
  { x: 0.32, y: 0.16, label: "SPEC" },
  { x: 0.78, y: 0.18, label: "CODE" },
  { x: 0.88, y: 0.64, label: "TESTS" },
];

const planner: Node = { x: 0.36, y: 0.36, label: "PLANNER" };
const agents: Node[] = [
  { x: 0.55, y: 0.22, label: "AGENT" },
  { x: 0.63, y: 0.42, label: "AGENT" },
  { x: 0.51, y: 0.58, label: "AGENT" },
];
const verifier: Node = { x: 0.74, y: 0.42, label: "VERIFY" };
const result: Node = { x: 0.86, y: 0.38, label: "RESULT" };

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const x = clamp((value - edge0) / (edge1 - edge0));
  return x * x * (3 - 2 * x);
}

function phaseWeight(cycle: number, start: number, peak: number, end: number) {
  if (cycle <= start || cycle >= end) return 0;
  if (cycle <= peak) return smoothstep(start, peak, cycle);
  return 1 - smoothstep(peak, end, cycle);
}

function pseudoRandom(x: number, y: number) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

function noise(x: number, y: number, t: number) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);

  const a = pseudoRandom(ix + t * 0.025, iy);
  const b = pseudoRandom(ix + 1 + t * 0.025, iy);
  const c = pseudoRandom(ix + t * 0.025, iy + 1);
  const d = pseudoRandom(ix + 1 + t * 0.025, iy + 1);

  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function distanceToSegment(px: number, py: number, from: Point, to: Point) {
  const vx = to.x - from.x;
  const vy = to.y - from.y;
  const wx = px - from.x;
  const wy = py - from.y;
  const segmentLength = vx * vx + vy * vy || 1;
  const t = clamp((wx * vx + wy * vy) / segmentLength);
  const closestX = from.x + vx * t;
  const closestY = from.y + vy * t;
  return Math.hypot(px - closestX, py - closestY);
}

function pointInfluence(px: number, py: number, point: Point, radiusX: number, radiusY: number) {
  const dx = (point.x - px) / radiusX;
  const dy = (point.y - py) / radiusY;
  return clamp(1 - Math.sqrt(dx * dx + dy * dy));
}

function pathInfluence(px: number, py: number, from: Point, to: Point, phase: number, pulseOffset: number) {
  const rail = 1 - smoothstep(0.002, 0.018, distanceToSegment(px, py, from, to));
  const pulseT = (phase + pulseOffset) % 1;
  const pulse = {
    x: from.x + (to.x - from.x) * pulseT,
    y: from.y + (to.y - from.y) * pulseT,
  };
  const pulseGlow = 1 - smoothstep(0.012, 0.06, Math.hypot(px - pulse.x, py - pulse.y));
  return clamp(rail * 0.34 + pulseGlow * 0.9);
}

function pickChar(chars: string[], seed: number) {
  return chars[Math.min(chars.length - 1, Math.floor(seed * chars.length))];
}

function drawGlow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: [number, number, number],
  alpha: number,
) {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`);
  gradient.addColorStop(0.52, `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha * 0.18})`);
  gradient.addColorStop(1, `rgba(${color[0]}, ${color[1]}, ${color[2]}, 0)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}

function drawGhostLabel(ctx: CanvasRenderingContext2D, width: number, height: number, node: Node, alpha: number) {
  if (alpha <= 0.01) return;

  ctx.save();
  ctx.font = `600 ${Math.max(10, Math.min(15, width * 0.012))}px "JetBrains Mono", monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = `rgba(232, 168, 124, ${alpha})`;
  ctx.fillText(node.label, node.x * width, node.y * height);
  ctx.restore();
}

export function AsciiCanvas({ className = "" }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ x: -1000, y: -1000, active: false });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrame = 0;
    let width = 0;
    let height = 0;
    let fontSize = 15;
    let charW = 8.7;
    let charH = 16.5;
    let lastPaint = 0;
    let isMobile = false;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      isMobile = rect.width < 640;
      const dpr = isMobile ? 1 : Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      fontSize = isMobile ? 16 : 15;
      charW = fontSize * 0.58;
      charH = fontSize * 1.15;
      lastPaint = 0;

      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = `${fontSize}px "JetBrains Mono", monospace`;
      ctx.textBaseline = "top";
    };

    const handleMove = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = { x: event.clientX - rect.left, y: event.clientY - rect.top, active: true };
    };

    const handleLeave = () => {
      mouseRef.current = { x: -1000, y: -1000, active: false };
    };

    const draw = () => {
      if (!isMobile) {
        animationFrame = requestAnimationFrame(draw);
      }
      if (document.hidden) return;

      const frameNow = performance.now();
      const frameInterval = isMobile ? MOBILE_FRAME_MS : DESKTOP_FRAME_MS;
      if (frameNow - lastPaint < frameInterval) return;
      lastPaint = frameNow;

      const now = frameNow * 0.001;
      const cycle = (now % CYCLE_SECONDS) / CYCLE_SECONDS;
      const gather = phaseWeight(cycle, 0.05, 0.22, 0.42);
      const split = phaseWeight(cycle, 0.27, 0.48, 0.68);
      const verify = phaseWeight(cycle, 0.52, 0.68, 0.84);
      const dissolve = phaseWeight(cycle, 0.78, 0.92, 1);
      const flowPhase = (now * 0.16) % 1;
      const mobile = isMobile;
      const centerMaskY = mobile ? 0.34 : 0.38;
      const mouse = mouseRef.current;

      ctx.globalAlpha = 1;
      ctx.fillStyle = "#090807";
      ctx.fillRect(0, 0, width, height);

      drawGlow(ctx, width * 0.36, height * 0.34, width * (mobile ? 0.4 : 0.22), [200, 121, 65], 0.05 + gather * 0.08);
      drawGlow(ctx, width * 0.62, height * 0.42, width * (mobile ? 0.44 : 0.26), [132, 111, 78], 0.04 + split * 0.07);
      drawGlow(ctx, width * 0.78, height * 0.4, width * (mobile ? 0.34 : 0.18), [232, 168, 124], 0.04 + verify * 0.09);

      const cols = Math.ceil(width / charW);
      const rows = Math.ceil(height / charH);

      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const px = col * charW;
          const py = row * charH;
          const nx = px / width;
          const ny = py / height;

          const vectorX = noise(nx * 3.4 + 11, ny * 3.4 + 5, now * 0.2) - 0.5;
          const vectorY = noise(nx * 3.4 + 29, ny * 3.4 + 17, now * 0.2) - 0.5;
          const layerA = noise(nx * 7.2 + vectorX * 1.8 + now * 0.12, ny * 7.2 + vectorY * 1.8, now * 0.7);
          const layerB = noise(nx * 13.8 + 50, ny * 13.8 + 20 + now * 0.08, now * 0.95);
          let brightness = layerA * 0.28 + layerB * 0.16;

          let signal = 0;
          sourceNodes.forEach((source, index) => {
            signal += pathInfluence(nx, ny, source, planner, flowPhase, index * 0.13) * gather;
          });
          agents.forEach((agent, index) => {
            signal += pathInfluence(nx, ny, planner, agent, flowPhase, index * 0.19) * split;
            signal += pathInfluence(nx, ny, agent, verifier, flowPhase, index * 0.21) * verify;
          });
          signal += pathInfluence(nx, ny, verifier, result, flowPhase, 0.33) * verify;
          signal *= 1 - dissolve * 0.72;

          const nodeGlow =
            pointInfluence(nx, ny, planner, 0.05, 0.08) * (0.28 + gather * 0.9) +
            pointInfluence(nx, ny, verifier, 0.05, 0.08) * (0.22 + verify * 0.95) +
            pointInfluence(nx, ny, result, 0.045, 0.07) * verify * 0.8 +
            agents.reduce((total, agent) => total + pointInfluence(nx, ny, agent, 0.045, 0.07) * split * 0.78, 0);

          const readableMask =
            pointInfluence(nx, ny, { x: 0.5, y: centerMaskY }, 0.34, mobile ? 0.14 : 0.13) * 0.7 +
            pointInfluence(nx, ny, { x: 0.5, y: mobile ? 0.51 : 0.55 }, 0.34, 0.13) * 0.54;
          const edgeVignette =
            smoothstep(0.04, 0.22, nx) *
            smoothstep(0.04, 0.22, ny) *
            smoothstep(0.04, 0.22, 1 - nx) *
            smoothstep(0.04, 0.22, 1 - ny);

          brightness *= 0.42 + edgeVignette * 0.58;
          brightness *= 1 - clamp(readableMask, 0, 0.66);
          brightness += signal * 0.52 + nodeGlow * 0.48;

          if (mouse.active) {
            const mouseDist = Math.hypot(mouse.x - px, mouse.y - py);
            brightness += Math.max(0, 1 - mouseDist / 170) * 0.16;
          }

          brightness = clamp(brightness);
          if (brightness < 0.13) continue;

          let chars = AMBIENT_CHARS;
          let color = `rgba(145, 119, 96, ${0.13 + brightness * 0.24})`;
          let alpha = 0.14 + brightness * 0.28;

          if (signal > 0.14) {
            chars = SIGNAL_CHARS;
            color = `rgba(200, 121, 65, ${0.2 + signal * 0.38})`;
            alpha = Math.max(alpha, 0.24 + signal * 0.34);
          }

          if (nodeGlow > 0.22) {
            chars = NODE_CHARS;
            color = `rgba(255, 188, 128, ${0.34 + nodeGlow * 0.42})`;
            alpha = Math.max(alpha, 0.34 + nodeGlow * 0.38);
          }

          const randomSeed = pseudoRandom(col * 0.7 + now * 0.58, row * 0.9 + now * 0.31);
          ctx.fillStyle = color;
          ctx.globalAlpha = clamp(alpha, 0.1, 0.86);
          ctx.fillText(pickChar(chars, randomSeed), px, py);
        }
      }

      ctx.globalAlpha = 1;
      drawGhostLabel(ctx, width, height, planner, 0.02 + gather * 0.08);
      agents.forEach((agent) => drawGhostLabel(ctx, width, height, agent, 0.015 + split * 0.06));
      drawGhostLabel(ctx, width, height, verifier, 0.02 + verify * 0.08);
      drawGhostLabel(ctx, width, height, result, 0.012 + verify * 0.05);
    };

    resize();
    draw();

    const handleResize = () => {
      resize();
      cancelAnimationFrame(animationFrame);
      draw();
    };

    window.addEventListener("resize", handleResize);
    canvas.addEventListener("mousemove", handleMove);
    canvas.addEventListener("mouseleave", handleLeave);

    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", handleResize);
      canvas.removeEventListener("mousemove", handleMove);
      canvas.removeEventListener("mouseleave", handleLeave);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={`absolute inset-0 h-full w-full ${className}`}
      style={{ imageRendering: "pixelated" }}
    />
  );
}
