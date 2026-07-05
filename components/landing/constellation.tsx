"use client";

import * as React from "react";
import { useReducedMotion } from "framer-motion";

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  hue: number; // 0 = cyan, 1 = violet
  label?: string;
  pulse: number;
}

const CYAN = [34, 211, 238];
const VIOLET = [124, 58, 237];

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
function rgb(t: number, alpha = 1) {
  return `rgba(${Math.round(lerp(CYAN[0], VIOLET[0], t))}, ${Math.round(
    lerp(CYAN[1], VIOLET[1], t),
  )}, ${Math.round(lerp(CYAN[2], VIOLET[2], t))}, ${alpha})`;
}

/**
 * Interactive constellation of "model" nodes drifting in deep space.
 * Edges pulse along a cyan→violet gradient; the field parallaxes toward the
 * cursor and nodes are magnetically nudged. Degrades to a calm static frame
 * under prefers-reduced-motion.
 */
export function Constellation({
  labels = [],
  density = 1,
  className,
}: {
  labels?: string[];
  density?: number;
  className?: string;
}) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const reduce = useReducedMotion();

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !canvas.parentElement) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Non-null typed aliases so nested animation closures keep the narrowing.
    const cv = canvas as HTMLCanvasElement;
    const c2d = ctx as CanvasRenderingContext2D;
    const parent = canvas.parentElement as HTMLElement;

    let width = 0;
    let height = 0;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let nodes: Node[] = [];
    let raf = 0;

    const mouse = { x: -9999, y: -9999, tx: -9999, ty: -9999, active: false };

    function build() {
      const rect = parent.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = width * dpr;
      cv.height = height * dpr;
      cv.style.width = `${width}px`;
      cv.style.height = `${height}px`;
      c2d.setTransform(dpr, 0, 0, dpr, 0, 0);

      const base = Math.round((width * height) / 22000) * density;
      const count = Math.max(18, Math.min(72, base));
      nodes = [];
      for (let i = 0; i < count; i++) {
        nodes.push({
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.5) * 0.18,
          vy: (Math.random() - 0.5) * 0.18,
          r: 1 + Math.random() * 1.8,
          hue: Math.random(),
          pulse: Math.random() * Math.PI * 2,
        });
      }
      // Assign labels to a spread of nodes near the upper area.
      labels.slice(0, nodes.length).forEach((label, i) => {
        const n = nodes[Math.floor((i + 0.5) * (nodes.length / Math.max(1, labels.length)))];
        if (n) {
          n.label = label;
          n.r = 2.6;
        }
      });
    }

    const LINK = Math.min(170, Math.max(120, Math.hypot(width, height) / 9));

    function frame(time: number) {
      c2d.clearRect(0, 0, width, height);
      const linkDist = Math.min(180, Math.max(110, width / 8));
      const dark = document.documentElement.classList.contains("dark");
      const labelColor = dark ? "rgba(231,233,238,0.55)" : "rgba(40,44,60,0.55)";

      // smooth parallax toward cursor
      mouse.x += (mouse.tx - mouse.x) * 0.06;
      mouse.y += (mouse.ty - mouse.y) * 0.06;
      const cx = width / 2;
      const cy = height / 2;
      const px = mouse.active ? (mouse.x - cx) * 0.02 : 0;
      const py = mouse.active ? (mouse.y - cy) * 0.02 : 0;

      // update
      for (const n of nodes) {
        n.x += n.vx;
        n.y += n.vy;
        if (n.x < -20) n.x = width + 20;
        if (n.x > width + 20) n.x = -20;
        if (n.y < -20) n.y = height + 20;
        if (n.y > height + 20) n.y = -20;

        // magnetic nudge toward cursor
        if (mouse.active) {
          const dx = mouse.x - n.x;
          const dy = mouse.y - n.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < 140 * 140) {
            const f = (1 - Math.sqrt(d2) / 140) * 0.4;
            n.x += dx * 0.002 * f * 60 * 0.016;
            n.y += dy * 0.002 * f * 60 * 0.016;
          }
        }
      }

      // edges
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist = Math.hypot(dx, dy);
          if (dist < linkDist) {
            const t = (a.hue + b.hue) / 2;
            const pulse = 0.5 + 0.5 * Math.sin(time * 0.0015 + (a.x + b.y) * 0.01);
            const alpha = (1 - dist / linkDist) * 0.5 * (0.5 + pulse * 0.5);
            c2d.strokeStyle = rgb(t, alpha);
            c2d.lineWidth = 0.7;
            c2d.beginPath();
            c2d.moveTo(a.x + px, a.y + py);
            c2d.lineTo(b.x + px, b.y + py);
            c2d.stroke();
          }
        }
      }

      // nodes
      for (const n of nodes) {
        const x = n.x + px;
        const y = n.y + py;
        const glow = 0.6 + 0.4 * Math.sin(time * 0.002 + n.pulse);
        const g = c2d.createRadialGradient(x, y, 0, x, y, n.r * 6);
        g.addColorStop(0, rgb(n.hue, 0.9 * glow));
        g.addColorStop(1, rgb(n.hue, 0));
        c2d.fillStyle = g;
        c2d.beginPath();
        c2d.arc(x, y, n.r * 6, 0, Math.PI * 2);
        c2d.fill();

        c2d.fillStyle = rgb(n.hue, 0.95);
        c2d.beginPath();
        c2d.arc(x, y, n.r, 0, Math.PI * 2);
        c2d.fill();

        if (n.label) {
          c2d.font =
            "500 11px ui-monospace, 'JetBrains Mono', monospace";
          c2d.fillStyle = labelColor;
          c2d.fillText(n.label, x + 8, y + 3);
        }
      }

      raf = requestAnimationFrame(frame);
    }

    function onMove(e: PointerEvent) {
      const rect = cv.getBoundingClientRect();
      mouse.tx = e.clientX - rect.left;
      mouse.ty = e.clientY - rect.top;
      mouse.active = true;
    }
    function onLeave() {
      mouse.active = false;
      mouse.tx = width / 2;
      mouse.ty = height / 2;
    }

    const ro = new ResizeObserver(() => {
      build();
      if (reduce) {
        // single static frame
        cancelAnimationFrame(raf);
        frameStatic();
      }
    });
    ro.observe(parent);
    build();

    function frameStatic() {
      // draw one calm frame without animation
      frame(0);
      cancelAnimationFrame(raf);
    }

    if (reduce) {
      frameStatic();
    } else {
      window.addEventListener("pointermove", onMove);
      parent.addEventListener("pointerleave", onLeave);
      raf = requestAnimationFrame(frame);
    }

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("pointermove", onMove);
      parent.removeEventListener("pointerleave", onLeave);
    };
  }, [labels, density, reduce]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      aria-hidden="true"
    />
  );
}
