// Lightweight self-contained confetti burst - no dependency, no external asset.
// Draws a short canvas animation over the whole viewport, then removes itself.
// Used to celebrate a submitted job report. Respects prefers-reduced-motion.
export function fireConfetti(durationMs = 2500): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  try {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  } catch {
    /* matchMedia unsupported - proceed */
  }

  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText =
    "position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:9999;";
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    canvas.remove();
    return;
  }

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = window.innerWidth;
  const H = window.innerHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.scale(dpr, dpr);

  const colors = ["#5dd6c2", "#6aa7ff", "#f59e0b", "#ff6b6b", "#c084fc", "#34d399"];
  type P = { x: number; y: number; vx: number; vy: number; rot: number; vr: number; size: number; color: string };
  const parts: P[] = [];
  for (let i = 0; i < 140; i++) {
    parts.push({
      x: W / 2 + (Math.random() - 0.5) * 120,
      y: H * 0.35 + (Math.random() - 0.5) * 60,
      vx: (Math.random() - 0.5) * 10,
      vy: Math.random() * -12 - 4,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.4,
      size: 6 + Math.random() * 6,
      color: colors[Math.floor(Math.random() * colors.length)],
    });
  }

  const start = performance.now();
  const gravity = 0.35;
  function frame(now: number) {
    const elapsed = now - start;
    ctx!.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.vy += gravity;
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.99;
      p.rot += p.vr;
      ctx!.save();
      ctx!.translate(p.x, p.y);
      ctx!.rotate(p.rot);
      ctx!.globalAlpha = Math.max(0, 1 - elapsed / durationMs);
      ctx!.fillStyle = p.color;
      ctx!.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      ctx!.restore();
    }
    if (elapsed < durationMs) {
      requestAnimationFrame(frame);
    } else {
      canvas.remove();
    }
  }
  requestAnimationFrame(frame);
}
