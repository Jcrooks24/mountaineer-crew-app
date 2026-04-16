import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

export type SignaturePadHandle = {
  toDataURL(): string;
  isEmpty(): boolean;
  clear(): void;
};

type Props = {
  height?: number;
};

const SignaturePad = forwardRef<SignaturePadHandle, Props>(function SignaturePad(
  { height = 150 },
  ref
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const empty = useRef(true);

  function fillBackground() {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#0b1220";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  function getCtx() {
    const ctx = canvasRef.current!.getContext("2d")!;
    ctx.strokeStyle = "#5dd6c2";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    return ctx;
  }

  function getPos(e: MouseEvent | Touch) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  useEffect(() => {
    const canvas = canvasRef.current!;

    // Set logical size to match CSS rendered size for crisp output
    const rect = canvas.getBoundingClientRect();
    if (rect.width > 0) {
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = height * window.devicePixelRatio;
      const ctx = canvas.getContext("2d")!;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    }
    fillBackground();

    const ctx = getCtx();

    function onMouseDown(e: MouseEvent) {
      drawing.current = true;
      const p = getPos(e);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    }
    function onMouseMove(e: MouseEvent) {
      if (!drawing.current) return;
      empty.current = false;
      const p = getPos(e);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    function stopDrawing() {
      drawing.current = false;
    }

    function onTouchStart(e: TouchEvent) {
      e.preventDefault();
      drawing.current = true;
      const p = getPos(e.touches[0]);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    }
    function onTouchMove(e: TouchEvent) {
      e.preventDefault();
      if (!drawing.current) return;
      empty.current = false;
      const p = getPos(e.touches[0]);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }

    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("mouseup", stopDrawing);
    canvas.addEventListener("mouseleave", stopDrawing);
    canvas.addEventListener("touchstart", onTouchStart, { passive: false });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    canvas.addEventListener("touchend", stopDrawing);

    return () => {
      canvas.removeEventListener("mousedown", onMouseDown);
      canvas.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("mouseup", stopDrawing);
      canvas.removeEventListener("mouseleave", stopDrawing);
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("touchend", stopDrawing);
    };
  }, [height]);

  useImperativeHandle(ref, () => ({
    toDataURL() {
      return canvasRef.current!.toDataURL("image/png");
    },
    isEmpty() {
      return empty.current;
    },
    clear() {
      empty.current = true;
      fillBackground();
    },
  }));

  return (
    <canvas
      ref={canvasRef}
      style={{
        display: "block",
        width: "100%",
        height,
        borderRadius: 8,
        border: "1px solid var(--border)",
        background: "var(--bg)",
        cursor: "crosshair",
        touchAction: "none",
      }}
    />
  );
});

export default SignaturePad;
