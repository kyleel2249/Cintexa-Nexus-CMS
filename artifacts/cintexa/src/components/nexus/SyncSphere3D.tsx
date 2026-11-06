import { useEffect, useRef } from "react";

export interface SphereNode { id: string; label: string; color: string; weight?: number }
export interface SphereLink { source: string; target: string; n: number }

/**
 * 3D view of how modules exchange data. Nodes sit on a sphere that slowly rotates (drag to turn it); link thickness
 * is proportional to the number of real sync events that travelled between the two modules. Canvas 2D with a hand-written
 * perspective projection, so there is no WebGL or third-party library. Animation pauses when the tab is hidden and is
 * replaced by a still frame when the viewer prefers reduced motion.
 */
export function SyncSphere3D({ nodes, links, height = 360 }: { nodes: SphereNode[]; links: SphereLink[]; height?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const state = useRef({ yaw: 0.6, pitch: 0.35, dragging: false, lx: 0, ly: 0 });

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || nodes.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let raf = 0;
    let w = 0;
    let h = 0;

    const n = nodes.length;
    const pts = nodes.map((node, i) => {
      // Fibonacci sphere: even spread for any node count.
      const y = n === 1 ? 0 : 1 - (i / (n - 1)) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const phi = i * Math.PI * (3 - Math.sqrt(5));
      return { node, x: Math.cos(phi) * r, y, z: Math.sin(phi) * r };
    });
    const index = new Map(pts.map((p, i) => [p.node.id, i]));
    const maxN = Math.max(1, ...links.map((l) => l.n));

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      w = Math.max(1, Math.floor(rect.width));
      h = height;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const project = (p: { x: number; y: number; z: number }) => {
      const s = state.current;
      const cy = Math.cos(s.yaw), sy = Math.sin(s.yaw), cp = Math.cos(s.pitch), sp = Math.sin(s.pitch);
      const x1 = p.x * cy + p.z * sy;
      const z1 = -p.x * sy + p.z * cy;
      const y2 = p.y * cp - z1 * sp;
      const z2 = p.y * sp + z1 * cp;
      const radius = Math.min(w, h) * 0.34;
      const persp = 1 / (1 - z2 * 0.35);
      return { sx: w / 2 + x1 * radius * persp, sy: h / 2 + y2 * radius * persp, depth: z2, scale: persp };
    };

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      const projected = pts.map(project);
      // links first
      for (const l of links) {
        const a = index.get(l.source), b = index.get(l.target);
        if (a == null || b == null || a === b) continue;
        const pa = projected[a]!, pb = projected[b]!;
        const depth = (pa.depth + pb.depth) / 2;
        ctx.globalAlpha = 0.25 + 0.5 * ((depth + 1) / 2);
        ctx.strokeStyle = pts[a]!.node.color;
        ctx.lineWidth = 0.8 + 3.2 * (Math.log(1 + l.n) / Math.log(1 + maxN));
        ctx.beginPath();
        ctx.moveTo(pa.sx, pa.sy);
        const mx = (pa.sx + pb.sx) / 2 + (h / 2 - (pa.sy + pb.sy) / 2) * 0.15;
        const my = (pa.sy + pb.sy) / 2 + (w / 2 - (pa.sx + pb.sx) / 2) * 0.15;
        ctx.quadraticCurveTo(mx, my, pb.sx, pb.sy);
        ctx.stroke();
      }
      // nodes back to front
      const order = projected.map((p, i) => i).sort((i, j) => projected[i]!.depth - projected[j]!.depth);
      const dark = document.documentElement.classList.contains("dark") || window.matchMedia?.("(prefers-color-scheme: dark)").matches;
      for (const i of order) {
        const p = projected[i]!, node = pts[i]!.node;
        const size = (9 + 7 * Math.min(1, (node.weight ?? 0) / 20)) * p.scale;
        ctx.globalAlpha = 0.55 + 0.45 * ((p.depth + 1) / 2);
        ctx.fillStyle = node.color;
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, size, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = dark ? "#e5e7eb" : "#111827";
        ctx.font = `${Math.round(10 + 2 * p.scale)}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(node.label, p.sx, p.sy + size + 12);
      }
      ctx.globalAlpha = 1;
    };

    const tick = () => {
      if (!state.current.dragging && !document.hidden) state.current.yaw += 0.004;
      draw();
      raf = requestAnimationFrame(tick);
    };

    resize();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => { resize(); draw(); }) : null;
    ro?.observe(canvas);
    if (reduce) draw(); else raf = requestAnimationFrame(tick);

    const down = (e: PointerEvent) => { state.current.dragging = true; state.current.lx = e.clientX; state.current.ly = e.clientY; canvas.setPointerCapture?.(e.pointerId); };
    const move = (e: PointerEvent) => {
      const s = state.current;
      if (!s.dragging) return;
      s.yaw += (e.clientX - s.lx) * 0.008;
      s.pitch = Math.max(-1.2, Math.min(1.2, s.pitch + (e.clientY - s.ly) * 0.008));
      s.lx = e.clientX; s.ly = e.clientY;
      if (reduce) draw();
    };
    const up = () => { state.current.dragging = false; };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
    };
  }, [nodes, links, height]);

  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={`3D map of ${nodes.length} modules and the data flowing between them`}
      style={{ width: "100%", height, touchAction: "pan-y", cursor: "grab" }}
    />
  );
}
