import { useEffect, useRef, useCallback, useMemo, useReducer } from 'react';
import { useStore, getActiveStroke } from '../state/store';
import { composite } from '../core/compositor';
import { rectSelection, lassoSelection } from '../tools/selection';
import type { PointerSample, Selection } from '../types';

/** screen px -> document px, inverting pan/rotate/zoom (applied in that order). */
function screenToDoc(
  sx: number, sy: number,
  vp: { panX: number; panY: number; zoom: number; rotation: number },
) {
  const x = sx - vp.panX;
  const y = sy - vp.panY;
  const cos = Math.cos(-vp.rotation);
  const sin = Math.sin(-vp.rotation);
  const rx = x * cos - y * sin;
  const ry = x * sin + y * cos;
  return { x: rx / vp.zoom, y: ry / vp.zoom };
}

/** Bounding box of the selected region (for a lightweight marquee overlay). */
function selectionBounds(sel: Selection | null) {
  if (!sel) return null;
  const { mask, width, height } = sel;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

type Gesture =
  | { type: 'move'; startX: number; startY: number; lastX: number; lastY: number }
  | { type: 'rect'; startX: number; startY: number; lastX: number; lastY: number }
  | { type: 'lasso'; points: { x: number; y: number }[] };

export function Canvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const doc = useStore((s) => s.doc);
  const viewport = useStore((s) => s.viewport);
  const rev = useStore((s) => s.rev);
  const tool = useStore((s) => s.tool);
  const isStroking = useStore((s) => s.isStroking);

  const beginStroke = useStore((s) => s.beginStroke);
  const extendStroke = useStore((s) => s.extendStroke);
  const endStroke = useStore((s) => s.endStroke);
  const pickColorAt = useStore((s) => s.pickColorAt);
  const floodFillAt = useStore((s) => s.floodFillAt);
  const moveActiveLayer = useStore((s) => s.moveActiveLayer);
  const setSelection = useStore((s) => s.setSelection);
  const setViewport = useStore((s) => s.setViewport);

  const panState = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const [, forceDraw] = useReducer((n: number) => n + 1, 0);

  const marquee = useMemo(() => selectionBounds(doc.selection), [doc.selection]);

  // Recomposite the document whenever it changes.
  useEffect(() => {
    if (!offscreenRef.current) offscreenRef.current = document.createElement('canvas');
    const off = offscreenRef.current;
    off.width = doc.width;
    off.height = doc.height;
    const octx = off.getContext('2d')!;
    octx.putImageData(composite(doc), 0, 0);
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, rev]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const off = offscreenRef.current;
    if (!canvas || !off) return;
    const ctx = canvas.getContext('2d')!;
    ctx.save();
    ctx.fillStyle = '#2b2b2b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.translate(viewport.panX, viewport.panY);
    ctx.rotate(viewport.rotation);
    ctx.scale(viewport.zoom, viewport.zoom);
    ctx.imageSmoothingEnabled = viewport.zoom < 1;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, doc.width, doc.height);
    ctx.drawImage(off, 0, 0);

    // live stroke overlay
    const st = getActiveStroke();
    if (st) {
      const cov = st.engine.coverage;
      const overlay = new Uint8ClampedArray(doc.width * doc.height * 4);
      const erase = st.engine.isErase();
      for (let i = 0; i < cov.length; i++) {
        const a = cov[i];
        if (a <= 0) continue;
        const o = i * 4;
        if (erase) {
          overlay[o] = 255; overlay[o + 1] = 255; overlay[o + 2] = 255; overlay[o + 3] = a * 128;
        } else {
          overlay[o] = st.color.r; overlay[o + 1] = st.color.g; overlay[o + 2] = st.color.b; overlay[o + 3] = a * 255;
        }
      }
      const tmp = document.createElement('canvas');
      tmp.width = doc.width; tmp.height = doc.height;
      tmp.getContext('2d')!.putImageData(new ImageData(overlay, doc.width, doc.height), 0, 0);
      ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
      ctx.drawImage(tmp, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
    }

    // selection marquee (dashed bounding box)
    if (marquee) {
      ctx.lineWidth = 1 / viewport.zoom;
      ctx.setLineDash([4 / viewport.zoom, 4 / viewport.zoom]);
      ctx.strokeStyle = '#ffffff';
      ctx.strokeRect(marquee.x, marquee.y, marquee.w, marquee.h);
      ctx.strokeStyle = '#000000';
      ctx.lineDashOffset = 4 / viewport.zoom;
      ctx.strokeRect(marquee.x, marquee.y, marquee.w, marquee.h);
      ctx.setLineDash([]);
    }

    // in-progress gesture preview
    const g = gesture.current;
    if (g && g.type === 'rect') {
      const x = Math.min(g.startX, g.lastX), y = Math.min(g.startY, g.lastY);
      ctx.lineWidth = 1 / viewport.zoom;
      ctx.setLineDash([4 / viewport.zoom, 4 / viewport.zoom]);
      ctx.strokeStyle = '#4a9eff';
      ctx.strokeRect(x, y, Math.abs(g.lastX - g.startX), Math.abs(g.lastY - g.startY));
      ctx.setLineDash([]);
    } else if (g && g.type === 'lasso' && g.points.length > 1) {
      ctx.lineWidth = 1 / viewport.zoom;
      ctx.strokeStyle = '#4a9eff';
      ctx.beginPath();
      ctx.moveTo(g.points[0].x, g.points[0].y);
      for (const p of g.points) ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    ctx.restore();
  }, [doc, viewport, marquee]);

  useEffect(() => { draw(); }, [draw, isStroking, rev]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const parent = canvas.parentElement!;
      canvas.width = parent.clientWidth;
      canvas.height = parent.clientHeight;
      draw();
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [draw]);

  const docPoint = (e: { clientX: number; clientY: number }) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return screenToDoc(e.clientX - rect.left, e.clientY - rect.top, viewport);
  };

  const sampleFrom = (e: React.PointerEvent): PointerSample => {
    const { x, y } = docPoint(e);
    return {
      x, y,
      pressure: e.pressure && e.pressure > 0 ? e.pressure : 0.5,
      tiltX: (e as any).tiltX, tiltY: (e as any).tiltY,
      t: e.timeStamp,
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    canvasRef.current!.setPointerCapture(e.pointerId);
    const middle = e.button === 1;
    if (tool === 'pan' || middle || (e.shiftKey && tool !== 'select-rect')) {
      panState.current = { x: e.clientX, y: e.clientY, panX: viewport.panX, panY: viewport.panY };
      return;
    }
    const s = sampleFrom(e);
    switch (tool) {
      case 'eyedropper': pickColorAt(s.x, s.y); break;
      case 'fill': floodFillAt(s.x, s.y); break;
      case 'brush':
      case 'eraser': beginStroke(s); break;
      case 'move':
      case 'transform': gesture.current = { type: 'move', startX: s.x, startY: s.y, lastX: s.x, lastY: s.y }; break;
      case 'select-rect': gesture.current = { type: 'rect', startX: s.x, startY: s.y, lastX: s.x, lastY: s.y }; break;
      case 'select-lasso': gesture.current = { type: 'lasso', points: [{ x: s.x, y: s.y }] }; break;
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (panState.current) {
      const dx = e.clientX - panState.current.x;
      const dy = e.clientY - panState.current.y;
      setViewport({ panX: panState.current.panX + dx, panY: panState.current.panY + dy });
      return;
    }
    const g = gesture.current;
    if (g) {
      const p = docPoint(e);
      if (g.type === 'lasso') g.points.push(p);
      else { g.lastX = p.x; g.lastY = p.y; }
      forceDraw();
      return;
    }
    if (!isStroking) return;
    const evts = (e.nativeEvent as any).getCoalescedEvents?.() ?? [e.nativeEvent];
    const rect = canvasRef.current!.getBoundingClientRect();
    for (const ne of evts) {
      const { x, y } = screenToDoc(ne.clientX - rect.left, ne.clientY - rect.top, viewport);
      extendStroke({ x, y, pressure: ne.pressure > 0 ? ne.pressure : 0.5, t: ne.timeStamp });
    }
  };

  const finishGesture = () => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (g.type === 'move') {
      moveActiveLayer(g.lastX - g.startX, g.lastY - g.startY);
    } else if (g.type === 'rect') {
      const w = Math.abs(g.lastX - g.startX), h = Math.abs(g.lastY - g.startY);
      if (w < 1 || h < 1) setSelection(null);
      else setSelection(rectSelection(doc.width, doc.height, g.startX, g.startY, g.lastX, g.lastY));
    } else if (g.type === 'lasso') {
      if (g.points.length >= 3) setSelection(lassoSelection(doc.width, doc.height, g.points));
      else setSelection(null);
    }
    forceDraw();
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (panState.current) { panState.current = null; return; }
    if (gesture.current) { finishGesture(); }
    else if (isStroking) endStroke();
    try { canvasRef.current!.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  };

  const onWheel = (e: React.WheelEvent) => {
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const z = Math.min(32, Math.max(0.05, viewport.zoom * factor));
    setViewport({ zoom: z });
  };

  return (
    <div className="canvas-area">
      <canvas
        ref={canvasRef}
        className="paint-canvas"
        style={{ touchAction: 'none', cursor: tool === 'pan' ? 'grab' : 'crosshair' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onWheel={onWheel}
      />
    </div>
  );
}
