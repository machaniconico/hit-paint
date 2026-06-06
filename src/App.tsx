import { useEffect, useRef, useState } from 'react';
import { useStore, type LayerEffectKind, type LiquifyMode } from './state/store';
import { Canvas } from './ui/Canvas';
import { rgbaToHex, hexToRgba } from './color/color';
import type { AdjustmentSpec, BlendMode, ToolId } from './types';
import type { AlignMode } from './core/layer-bounds';
import type { SymmetryConfig } from './engine/symmetry';
import type { HarmonyScheme } from './color/palette';
import { BLEND_MODES } from './types';
import { importPSD, exportPSD } from './io/psd';
import { importCLIP, exportCLIP } from './io/clip';
import { exportPNG, importImageFile } from './io/png';
import { pickFile, downloadBlob } from './io/files';
import type { ShapeKind } from './vector/shape';

function guessMime(name: string): string {
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
  if (name.endsWith('.webp')) return 'image/webp';
  if (name.endsWith('.gif')) return 'image/gif';
  return 'application/octet-stream';
}

const TOOLS: { id: ToolId; label: string; key: string }[] = [
  { id: 'brush', label: 'ブラシ', key: 'B' },
  { id: 'eraser', label: '消しゴム', key: 'E' },
  { id: 'fill', label: '塗りつぶし', key: 'G' },
  { id: 'gradient', label: 'グラデーション', key: 'Shift+G' },
  { id: 'pen', label: 'ペン', key: 'P' },
  { id: 'text', label: 'テキスト', key: 'T' },
  { id: 'shape', label: 'シェイプ', key: 'U' },
  { id: 'eyedropper', label: 'スポイト', key: 'I' },
  { id: 'liquify', label: '液状化', key: 'L' },
  { id: 'select-rect', label: '矩形選択', key: 'M' },
  { id: 'select-ellipse', label: '楕円選択', key: 'Shift+M' },
  { id: 'move', label: '移動', key: 'V' },
  { id: 'magic-wand', label: '自動選択', key: 'W' },
  { id: 'transform', label: '変形', key: 'R' },
  { id: 'pan', label: '手のひら', key: 'H' },
];

type EffectBrushKind = 'blur' | 'sharpen' | 'dodge' | 'burn';
type ToolDrag = {
  tool: 'gradient' | 'select-ellipse';
  startX: number;
  startY: number;
};

const EFFECT_BRUSH_KINDS: { kind: EffectBrushKind; label: string }[] = [
  { kind: 'blur', label: 'ぼかし' },
  { kind: 'sharpen', label: 'シャープ' },
  { kind: 'dodge', label: '覆い焼き' },
  { kind: 'burn', label: '焼き込み' },
];

const LIQUIFY_MODES: { mode: LiquifyMode; label: string }[] = [
  { mode: 'push', label: '押す' },
  { mode: 'bloat', label: '膨張' },
  { mode: 'pinch', label: '収縮' },
];

const ADJUSTMENT_TYPES: { type: AdjustmentSpec['type']; label: string; opts?: Record<string, number> }[] = [
  { type: 'brightness-contrast', label: '明るさ・コントラスト', opts: { brightness: 10, contrast: 10 } },
  { type: 'invert', label: '階調反転' },
  { type: 'grayscale', label: 'グレースケール' },
  { type: 'hue-saturation', label: '色相・彩度', opts: { hue: 0, saturation: 20 } },
  { type: 'levels', label: 'レベル', opts: { inBlack: 16, inWhite: 239, gamma: 1, outBlack: 0, outWhite: 255 } },
];

const ALIGN_BUTTONS: { mode: AlignMode; label: string }[] = [
  { mode: 'left', label: '左' },
  { mode: 'hcenter', label: '中央' },
  { mode: 'right', label: '右' },
  { mode: 'top', label: '上' },
  { mode: 'vcenter', label: '中' },
  { mode: 'bottom', label: '下' },
];

const LAYER_EFFECT_BUTTONS: { kind: LayerEffectKind; label: string }[] = [
  { kind: 'drop-shadow', label: 'ドロップシャドウ' },
  { kind: 'stroke', label: '縁取り' },
  { kind: 'glow', label: '光彩' },
  { kind: 'inner-shadow', label: 'インナーシャドウ' },
  { kind: 'bevel-emboss', label: 'ベベル・エンボス' },
];

const SHAPE_KIND_OPTIONS: { kind: ShapeKind; label: string }[] = [
  { kind: 'rect', label: '矩形' },
  { kind: 'rounded-rect', label: '角丸矩形' },
  { kind: 'ellipse', label: '楕円' },
  { kind: 'polygon', label: '多角形' },
  { kind: 'star', label: '星形' },
  { kind: 'line', label: '線' },
];

const SYMMETRY_MODES: { mode: SymmetryConfig['mode']; label: string }[] = [
  { mode: 'none', label: 'なし' },
  { mode: 'horizontal', label: '水平' },
  { mode: 'vertical', label: '垂直' },
  { mode: 'both', label: '両方' },
  { mode: 'radial', label: '放射' },
];

const HARMONY_SCHEMES: { scheme: HarmonyScheme; label: string }[] = [
  { scheme: 'complementary', label: '補色' },
  { scheme: 'analogous', label: '類似' },
  { scheme: 'triadic', label: '三色' },
  { scheme: 'tetradic', label: '四色' },
];

function screenToDoc(
  sx: number,
  sy: number,
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

export function App() {
  const s = useStore();
  const [penStrokeWidth, setPenStrokeWidth] = useState(2);
  const [blurRadius, setBlurRadius] = useState(4);
  const [gammaValue, setGammaValue] = useState(1.5);
  const [motionBlurAngle, setMotionBlurAngle] = useState(0);
  const [motionBlurDistance, setMotionBlurDistance] = useState(8);
  const [zoomBlurStrength, setZoomBlurStrength] = useState(0.35);
  const [mosaicBlockSize, setMosaicBlockSize] = useState(4);
  const [quantizeMaxColors, setQuantizeMaxColors] = useState(16);
  const [canvasW, setCanvasW] = useState(s.doc.width);
  const [canvasH, setCanvasH] = useState(s.doc.height);
  const [resizeFromCenter, setResizeFromCenter] = useState(false);
  const [effectBrushKind, setEffectBrushKind] = useState<EffectBrushKind>('blur');
  const toolDrag = useRef<ToolDrag | null>(null);
  const activeLayer = s.doc.layers.find((l) => l.id === s.doc.activeLayerId);
  const activeTextData = activeLayer?.textData;
  const activeShapeData = activeLayer?.shapeData;
  const canFilterActive = Boolean(activeLayer?.pixels && activeLayer.kind === 'raster' && !activeLayer.locked);
  const canMaskActive = Boolean(activeLayer?.pixels && activeLayer.kind === 'raster');
  const canTransformActive = Boolean(activeLayer?.pixels && activeLayer.kind === 'raster' && !activeLayer.locked);
  const canCommitPenFill = Boolean(s.penPath && s.penPath.closed && s.penPath.points.length >= 3);
  const canCommitPenStroke = Boolean(s.penPath && s.penPath.points.length >= 2);

  useEffect(() => {
    setCanvasW(s.doc.width);
    setCanvasH(s.doc.height);
  }, [s.doc.width, s.doc.height]);

  const openFile = async () => {
    try {
      const picked = await pickFile('.psd,.clip,.png,.jpg,.jpeg,.webp,.gif,image/*');
      if (!picked) return;
      const lower = picked.name.toLowerCase();
      const result = lower.endsWith('.psd')
        ? await importPSD(picked.buffer)
        : lower.endsWith('.clip')
          ? await importCLIP(picked.buffer)
          : await importImageFile(picked.buffer, guessMime(lower), picked.name.replace(/\.[^.]+$/, ''));
      s.loadDocument(result.doc);
      if (result.warnings.length) {
        // eslint-disable-next-line no-alert
        alert('読み込み時の注意:\n' + result.warnings.join('\n'));
      }
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert('読み込みに失敗しました: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  const savePSD = () => {
    const buf = exportPSD(useStore.getState().doc);
    downloadBlob(new Blob([buf], { type: 'image/vnd.adobe.photoshop' }), `${s.doc.name}.psd`);
  };
  const saveCLIP = async () => {
    const buf = await exportCLIP(useStore.getState().doc);
    downloadBlob(new Blob([buf], { type: 'application/octet-stream' }), `${s.doc.name}.clip`);
  };
  const exportPng = async () => {
    const blob = await exportPNG(useStore.getState().doc);
    downloadBlob(blob, `${s.doc.name}.png`);
  };

  const stagePoint = (e: React.PointerEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return screenToDoc(e.clientX - rect.left, e.clientY - rect.top, s.viewport);
  };

  const centerPoint = () => ({
    x: Math.floor(s.doc.width / 2),
    y: Math.floor(s.doc.height / 2),
  });

  return (
    <div className="app">
      <header className="menubar">
        <span className="brand">HIT&nbsp;Paint</span>
        <button onClick={() => s.newDocument()}>新規</button>
        <button onClick={openFile}>開く</button>
        <button onClick={savePSD} title="Photoshop形式で保存">PSD保存</button>
        <button onClick={saveCLIP} title="CLIP形式で保存（HIT Paintで再読込可）">CLIP保存</button>
        <button onClick={exportPng}>PNG書き出し</button>
        <span className="divider" />
        <button onClick={s.undo} disabled={!s.canUndo}>元に戻す</button>
        <button onClick={s.redo} disabled={!s.canRedo}>やり直し</button>
        <span className="divider" />
        <button onClick={s.selectAllArea}>全選択</button>
        <button onClick={s.invertSelectionArea}>選択反転</button>
        <button onClick={s.clearSelection} disabled={!s.doc.selection}>選択解除</button>
        <span className="spacer" />
        <span className="docinfo">{s.doc.name} — {s.doc.width}×{s.doc.height}</span>
      </header>

      <div className="body">
        <aside className="toolbar">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              className={s.tool === t.id ? 'tool active' : 'tool'}
              title={`${t.label} (${t.key})`}
              onClick={() => s.setTool(t.id)}
            >
              {t.label}
            </button>
          ))}
        </aside>

        <main
          className="stage"
          onPointerDownCapture={(e) => {
            if (s.tool === 'magic-wand') {
              e.preventDefault();
              e.stopPropagation();
              const point = stagePoint(e);
              s.magicWandSelectAt(point.x, point.y, s.fillTolerance, true);
              return;
            }
            if (s.tool === 'pen') {
              e.preventDefault();
              e.stopPropagation();
              const point = stagePoint(e);
              s.addPenPoint(point.x, point.y);
              return;
            }
            if (s.tool === 'gradient' || s.tool === 'select-ellipse') {
              e.preventDefault();
              e.stopPropagation();
              const point = stagePoint(e);
              toolDrag.current = { tool: s.tool, startX: point.x, startY: point.y };
              e.currentTarget.setPointerCapture(e.pointerId);
              return;
            }
            if (s.tool !== 'text') return;
            e.preventDefault();
            e.stopPropagation();

            const point = stagePoint(e);
            const text = window.prompt('テキストを入力');
            if (text) s.createTextLayerAt(point.x, point.y, text);
          }}
          onPointerUpCapture={(e) => {
            const drag = toolDrag.current;
            if (!drag) return;
            e.preventDefault();
            e.stopPropagation();
            toolDrag.current = null;
            const point = stagePoint(e);
            if (drag.tool === 'gradient') {
              s.applyGradient(drag.startX, drag.startY, point.x, point.y);
            } else {
              const x = Math.min(drag.startX, point.x);
              const y = Math.min(drag.startY, point.y);
              const w = Math.abs(point.x - drag.startX);
              const h = Math.abs(point.y - drag.startY);
              if (w < 1 || h < 1) s.clearSelection();
              else s.selectEllipse({ x, y, w, h });
            }
            try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
          }}
        >
          <Canvas />
        </main>

        <aside className="rightpanel">
          <section className="panel">
            <h3>カラー</h3>
            <input
              type="color"
              value={rgbaToHex(s.primary)}
              onChange={(e) => s.setPrimary(hexToRgba(e.target.value))}
            />
            <div className="swatches">
              {['#000000', '#ffffff', '#ff3b30', '#34c759', '#007aff', '#ffcc00'].map((c) => (
                <button key={c} className="swatch" style={{ background: c }}
                  onClick={() => s.setPrimary(hexToRgba(c))} />
              ))}
            </div>
          </section>

          <section className="panel palette-panel">
            <h3>スウォッチ</h3>
            <div className="swatch-actions">
              <button className="mini" onClick={s.addSwatchAction}>追加</button>
              <button className="mini" onClick={() => s.generateHarmony('complementary')}>補色</button>
              <button className="mini" onClick={() => s.generateHarmony('analogous')}>類似</button>
            </div>
            <div className="swatches saved-swatches">
              {s.swatches.map((color, index) => (
                <button
                  key={`${color.r}-${color.g}-${color.b}-${color.a}-${index}`}
                  className="swatch"
                  style={{ background: rgbaToHex(color), opacity: color.a / 255 }}
                  title={`swatch ${index + 1}`}
                  onClick={() => s.selectSwatch(index)}
                  onDoubleClick={() => s.removeSwatchAction(index)}
                />
              ))}
            </div>
            <div className="harmony-grid">
              {HARMONY_SCHEMES.map((item) => (
                <button
                  key={item.scheme}
                  className="mini"
                  onClick={() => s.generateHarmony(item.scheme)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </section>

          <section className="panel">
            <h3>ブラシ</h3>
            <label>サイズ <b>{s.brush.size}px</b>
              <input type="range" min={1} max={300} value={s.brush.size}
                onChange={(e) => s.setBrush({ size: +e.target.value })} />
            </label>
            <label>不透明度 <b>{Math.round(s.brush.opacity * 100)}%</b>
              <input type="range" min={0} max={100} value={s.brush.opacity * 100}
                onChange={(e) => s.setBrush({ opacity: +e.target.value / 100 })} />
            </label>
            <label>硬さ <b>{Math.round(s.brush.hardness * 100)}%</b>
              <input type="range" min={0} max={100} value={s.brush.hardness * 100}
                onChange={(e) => s.setBrush({ hardness: +e.target.value / 100 })} />
            </label>
            <label className="check">
              <input type="checkbox" checked={s.brush.pressureSize}
                onChange={(e) => s.setBrush({ pressureSize: e.target.checked })} />
              筆圧→サイズ
            </label>
            <label className="check">
              <input type="checkbox" checked={s.brush.pressureOpacity}
                onChange={(e) => s.setBrush({ pressureOpacity: e.target.checked })} />
              筆圧→不透明度
            </label>
          </section>

          <section className="panel">
            <h3>ブラシ詳細</h3>
            <label>サイズジッター <b>{Math.round((s.dynamics.sizeJitter ?? 0) * 100)}%</b>
              <input type="range" min={0} max={100} value={(s.dynamics.sizeJitter ?? 0) * 100}
                onChange={(e) => s.setDynamics({ sizeJitter: +e.target.value / 100 })} />
            </label>
            <label>不透明度ジッター <b>{Math.round((s.dynamics.opacityJitter ?? 0) * 100)}%</b>
              <input type="range" min={0} max={100} value={(s.dynamics.opacityJitter ?? 0) * 100}
                onChange={(e) => s.setDynamics({ opacityJitter: +e.target.value / 100 })} />
            </label>
            <label>散布 <b>{Math.round(s.dynamics.scatter ?? 0)}px</b>
              <input type="range" min={0} max={100} value={s.dynamics.scatter ?? 0}
                onChange={(e) => s.setDynamics({ scatter: +e.target.value })} />
            </label>
          </section>

          <section className="panel symmetry-panel">
            <h3>対称</h3>
            <label>モード
              <select
                value={s.symmetry.mode}
                onChange={(e) => s.setSymmetry({ mode: e.target.value as SymmetryConfig['mode'] })}
              >
                {SYMMETRY_MODES.map((item) => (
                  <option key={item.mode} value={item.mode}>{item.label}</option>
                ))}
              </select>
            </label>
            <label>分割 <b>{s.symmetry.slices ?? 6}</b>
              <input
                type="number"
                min={2}
                max={24}
                step={1}
                value={s.symmetry.slices ?? 6}
                onChange={(e) => {
                  const slices = Math.max(2, Math.trunc(Number(e.target.value) || 2));
                  s.setSymmetry({ slices });
                }}
              />
            </label>
          </section>

          <section className="panel">
            <h3>塗りつぶし</h3>
            <label>許容値 <b>{s.fillTolerance}</b>
              <input type="range" min={0} max={255} value={s.fillTolerance}
                onChange={(e) => s.setFillTolerance(+e.target.value)} />
            </label>
            <button className="mini wide" onClick={s.fillSelectionWithPrimary}>
              {s.doc.selection ? '選択範囲を描画色で塗る' : 'レイヤーを描画色で塗る'}
            </button>
          </section>

          {s.tool === 'pen' && (
            <section className="panel pen-panel">
              <h3>ペン</h3>
              <label>線幅 <b>{penStrokeWidth}px</b>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={penStrokeWidth}
                  onChange={(e) => setPenStrokeWidth(Math.max(1, Math.trunc(Number(e.target.value) || 1)))}
                />
              </label>
              <div className="pen-actions">
                <button className="mini" disabled={!canCommitPenFill} onClick={() => s.commitPenPath('fill')}>
                  塗りで確定
                </button>
                <button
                  className="mini"
                  disabled={!canCommitPenStroke}
                  onClick={() => s.commitPenPath('stroke', penStrokeWidth)}
                >
                  線で確定
                </button>
                <button className="mini" disabled={!s.penPath} onClick={s.closePenPath}>閉じる</button>
                <button className="mini" disabled={!s.penPath} onClick={s.cancelPenPath}>取消</button>
              </div>
            </section>
          )}

          {activeTextData && (
            <section className="panel text-edit">
              <h3>テキスト編集</h3>
              <label>文字
                <textarea
                  value={activeTextData.text}
                  onChange={(e) => s.updateActiveTextLayer({ text: e.target.value })}
                />
              </label>
              <label>サイズ
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={activeTextData.scale ?? 1}
                  onChange={(e) => {
                    const scale = Number(e.target.value);
                    if (Number.isFinite(scale)) {
                      s.updateActiveTextLayer({ scale: Math.max(1, Math.trunc(scale)) });
                    }
                  }}
                />
              </label>
              <label>色
                <input
                  type="color"
                  value={rgbaToHex(activeTextData.color)}
                  onChange={(e) => s.updateActiveTextLayer({ color: hexToRgba(e.target.value) })}
                />
              </label>
            </section>
          )}

          <section className="panel filters">
            <h3>フィルター</h3>
            <label>ぼかし半径 <b>{blurRadius}px</b>
              <input type="range" min={1} max={24} value={blurRadius}
                onChange={(e) => setBlurRadius(+e.target.value)} />
            </label>
            <label>ガンマ <b>{gammaValue.toFixed(1)}</b>
              <input type="range" min={0.2} max={4} step={0.1} value={gammaValue}
                onChange={(e) => setGammaValue(+e.target.value)} />
            </label>
            <div className="filter-control-row">
              <label>モーション角度 <b>{motionBlurAngle}°</b>
                <input type="range" min={-180} max={180} step={1} value={motionBlurAngle}
                  onChange={(e) => setMotionBlurAngle(+e.target.value)} />
              </label>
              <label>距離 <b>{motionBlurDistance}px</b>
                <input type="range" min={1} max={32} step={1} value={motionBlurDistance}
                  onChange={(e) => setMotionBlurDistance(+e.target.value)} />
              </label>
            </div>
            <label>放射強度 <b>{zoomBlurStrength.toFixed(2)}</b>
              <input type="range" min={0.05} max={1} step={0.05} value={zoomBlurStrength}
                onChange={(e) => setZoomBlurStrength(+e.target.value)} />
            </label>
            <label>モザイクサイズ <b>{mosaicBlockSize}px</b>
              <input type="range" min={2} max={32} value={mosaicBlockSize}
                onChange={(e) => setMosaicBlockSize(+e.target.value)} />
            </label>
            <label>減色数 <b>{quantizeMaxColors}</b>
              <input type="range" min={2} max={64} value={quantizeMaxColors}
                onChange={(e) => setQuantizeMaxColors(+e.target.value)} />
            </label>
            <div className="filter-grid">
              <button className="mini" disabled={!canFilterActive}
                onClick={() => s.applyFilter('blur', { radius: blurRadius })}>ぼかし</button>
              <button className="mini" disabled={!canFilterActive}
                onClick={() => s.applyFilter('brightness-contrast', { brightness: 10, contrast: 10 })}>
                明るさ・コントラスト
              </button>
              <button className="mini" disabled={!canFilterActive}
                onClick={() => s.applyFilter('invert')}>階調反転</button>
              <button className="mini" disabled={!canFilterActive}
                onClick={() => s.applyFilter('grayscale')}>グレースケール</button>
              <button className="mini" disabled={!canFilterActive}
                onClick={() => s.applyFilter('channel-mixer', {
                  monochrome: true,
                  red: { r: 0.299, g: 0.587, b: 0.114 },
                  green: { r: 0, g: 0, b: 0 },
                  blue: { r: 0, g: 0, b: 0 },
                })}>チャンネルミキサー</button>
              <button className="mini" disabled={!canFilterActive}
                onClick={() => s.applyFilter('sharpen', { amount: 0.75 })}>シャープ</button>
              <button className="mini" disabled={!canFilterActive}
                onClick={() => s.applyFilter('unsharp', { amount: 1, radius: 1 })}>アンシャープ</button>
              <button className="mini" disabled={!canFilterActive}
                onClick={() => s.applyFilter('clarity', { amount: 0.5, radius: 3 })}>クラリティ</button>
              <button className="mini" disabled={!canFilterActive}
                onClick={() => s.applyFilter('replace-color', {
                  from: s.primary,
                  to: s.secondary,
                  tolerance: s.fillTolerance,
                  fuzziness: 16,
                })}>色置換</button>
              <button className="mini" disabled={!canFilterActive}
                onClick={() => s.applyFilter('threshold', { level: 128 })}>しきい値</button>
              <button className="mini" disabled={!canFilterActive}
                onClick={() => s.applyFilter('posterize', { levels: 4 })}>ポスタライズ</button>
              <button className="mini" disabled={!canFilterActive}
                onClick={() => s.applyFilter('sepia')}>セピア</button>
              <button className="mini" disabled={!canFilterActive}
                onClick={() => s.applyFilter('auto-levels')}>オートレベル</button>
              <button className="mini" disabled={!canFilterActive}
                onClick={() => s.applyFilter('auto-contrast')}>オートコントラスト</button>
              <button className="mini" disabled={!canFilterActive}
                onClick={() => s.applyFilter('equalize')}>ヒストグラム等化</button>
              <button className="mini" disabled={!canFilterActive}
                onClick={() => s.applyFilter('gamma', { gamma: gammaValue })}>ガンマ補正</button>
              <button className="mini" disabled={!canFilterActive}
                onClick={() => s.applyFilter('motion-blur', { angle: motionBlurAngle, distance: motionBlurDistance })}>
                モーションブラー
              </button>
              <button className="mini" disabled={!canFilterActive}
                onClick={() => s.applyFilter('zoom-blur', { strength: zoomBlurStrength })}>放射ブラー</button>
              <button className="mini" disabled={!canFilterActive}
                onClick={() => s.applyFilter('lens', { amount: 0.3 })}>レンズ歪み</button>
              <button className="mini" disabled={!canFilterActive}
                onClick={() => s.applyFilter('sobel-edge')}>エッジ抽出</button>
              <button className="mini" disabled={!canFilterActive}
                onClick={() => s.applyFilter('emboss')}>エンボス</button>
              <button className="mini" disabled={!canFilterActive}
                onClick={() => s.applyFilter('vignette', { amount: 0.5 })}>ビネット</button>
              <button className="mini" disabled={!canFilterActive}
                onClick={() => s.applyFilter('mosaic', { blockSize: mosaicBlockSize })}>モザイク</button>
              <button className="mini" disabled={!canFilterActive}
                onClick={() => s.applyFilter('ordered-dither', { levels: 4 })}>ディザ</button>
              <button className="mini" disabled={!canFilterActive}
                onClick={() => s.applyFilter('quantize', { maxColors: quantizeMaxColors })}>減色</button>
              <button className="mini" disabled={!canFilterActive}
                onClick={() => s.applyFilter('color-balance', { midtones: [8, 0, -8] })}>
                カラーバランス
              </button>
              <button className="mini wide" disabled={!canFilterActive}
                onClick={() => s.applyFilter('gradient-map', {
                  stops: [
                    { t: 0, color: { r: 24, g: 35, b: 80, a: 255 } },
                    { t: 1, color: { r: 255, g: 236, b: 184, a: 255 } },
                  ],
                })}>
                グラデーションマップ
              </button>
              <button className="mini wide" disabled={!canFilterActive}
                onClick={() => s.applyFilter('curves', {
                  rgb: [
                    { x: 0, y: 0 },
                    { x: 128, y: 148 },
                    { x: 255, y: 255 },
                  ],
                })}>
                トーンカーブ
              </button>
            </div>
          </section>

          <section className="panel adjustments">
            <h3>調整レイヤー</h3>
            <div className="adjustment-grid">
              {ADJUSTMENT_TYPES.map((item) => (
                <button
                  key={item.type}
                  className="mini"
                  onClick={() => s.addAdjustmentLayer(item.type, item.opts)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </section>

          <section className="panel selection-tools">
            <h3>選択範囲</h3>
            <div className="selection-grid">
              <button className="mini"
                onClick={() => s.selectEllipse({
                  x: s.doc.width * 0.25,
                  y: s.doc.height * 0.25,
                  w: s.doc.width * 0.5,
                  h: s.doc.height * 0.5,
                })}>楕円</button>
              <button className="mini" disabled={!canFilterActive}
                onClick={() => {
                  const point = centerPoint();
                  s.magicWandSelectAt(point.x, point.y, s.fillTolerance, true);
                }}>自動選択</button>
              <button className="mini" disabled={!s.doc.selection}
                onClick={() => s.growSelectionBy(4)}>拡張</button>
              <button className="mini" disabled={!s.doc.selection}
                onClick={() => s.shrinkSelectionBy(4)}>収縮</button>
              <button className="mini" disabled={!s.doc.selection}
                onClick={() => s.featherSelectionBy(4)}>ぼかし</button>
            </div>
          </section>

          <section className="panel tool-actions">
            <h3>ツール実行</h3>
            {s.tool === 'liquify' && (
              <div className="liquify-mode-grid" aria-label="液状化モード">
                {LIQUIFY_MODES.map((item) => (
                  <button
                    key={item.mode}
                    className={s.liquifyMode === item.mode ? 'mini active' : 'mini'}
                    onClick={() => s.setLiquifyMode(item.mode)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
            <button className="mini wide" disabled={!canFilterActive}
              onClick={() => s.applyGradient(0, 0, Math.max(1, s.doc.width - 1), 0)}>
              横グラデーション
            </button>
            <div className="effect-kind-grid">
              {EFFECT_BRUSH_KINDS.map((item) => (
                <button
                  key={item.kind}
                  className={effectBrushKind === item.kind ? 'mini active' : 'mini'}
                  onClick={() => setEffectBrushKind(item.kind)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <button className="mini wide" disabled={!canFilterActive}
              onClick={() => {
                const point = centerPoint();
                s.effectBrushDab(effectBrushKind, point.x, point.y);
              }}>
              効果ブラシ
            </button>
          </section>

          <section className="panel transform-tools">
            <h3>変換</h3>
            <div className="transform-grid">
              <button className="mini" disabled={!canTransformActive}
                onClick={() => s.flipActiveLayer('h')}>左右反転</button>
              <button className="mini" disabled={!canTransformActive}
                onClick={() => s.flipActiveLayer('v')}>上下反転</button>
              <button className="mini" disabled={!canTransformActive}
                onClick={() => s.rotateActiveLayer('cw')}>回転CW</button>
              <button className="mini" disabled={!canTransformActive}
                onClick={() => s.rotateActiveLayer('ccw')}>回転CCW</button>
              <button className="mini wide" disabled={!canTransformActive}
                onClick={() => s.rotateActiveLayer('180')}>180度</button>
            </div>
          </section>

          <section className="panel align-tools">
            <h3>整列</h3>
            <div className="align-grid">
              {ALIGN_BUTTONS.map((item) => (
                <button
                  key={item.mode}
                  className="mini"
                  disabled={!canTransformActive}
                  onClick={() => s.alignActiveLayer(item.mode)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </section>

          <section className="panel doc-tools">
            <h3>ドキュメント</h3>
            <button className="mini wide" disabled={!s.doc.selection} onClick={s.cropToSelection}>
              選択範囲でクロップ
            </button>
            <div className="canvas-size">
              <label>W
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={canvasW}
                  onChange={(e) => setCanvasW(Math.max(1, Math.trunc(Number(e.target.value) || 1)))}
                />
              </label>
              <label>H
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={canvasH}
                  onChange={(e) => setCanvasH(Math.max(1, Math.trunc(Number(e.target.value) || 1)))}
                />
              </label>
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={resizeFromCenter}
                onChange={(e) => setResizeFromCenter(e.target.checked)}
              />
              中央基準
            </label>
            <button className="mini wide"
              onClick={() => s.resizeCanvasTo(canvasW, canvasH, resizeFromCenter ? 'center' : 'top-left')}>
              キャンバスサイズ変更
            </button>
          </section>

          <section className="panel anim-panel">
            <h3>
              アニメ
              <span className="anim-fps">{s.timeline.fps}fps</span>
            </h3>
            <div className="frame-strip" aria-label="アニメフレーム">
              {s.timeline.frames.map((frame, index) => (
                <button
                  key={frame.id}
                  className={index === s.timeline.currentIndex ? 'frame-button active' : 'frame-button'}
                  title={`${index + 1}フレーム / ${frame.durationMs}ms`}
                  onClick={() => s.gotoAnimFrame(index)}
                >
                  {index + 1}
                </button>
              ))}
            </div>
            <div className="anim-actions">
              <button
                className="mini"
                disabled={s.timeline.currentIndex <= 0}
                onClick={() => s.gotoAnimFrame(s.timeline.currentIndex - 1)}
              >
                前
              </button>
              <button
                className="mini"
                disabled={s.timeline.currentIndex >= s.timeline.frames.length - 1}
                onClick={() => s.gotoAnimFrame(s.timeline.currentIndex + 1)}
              >
                次
              </button>
              <button className="mini" onClick={s.addAnimFrame}>追加</button>
              <button className="mini" onClick={s.addAnimFrame}>複製</button>
              <button
                className="mini"
                disabled={s.timeline.frames.length <= 1}
                onClick={() => s.removeAnimFrame(s.timeline.currentIndex)}
              >
                削除
              </button>
            </div>
            <label className="check anim-toggle">
              <input
                type="checkbox"
                checked={s.onionSkinEnabled}
                onChange={(e) => s.setOnionSkin(e.target.checked)}
              />
              オニオンスキン
            </label>
          </section>

          <section className="panel layers">
            <h3>
              レイヤー
              <span className="layer-actions">
                <button className="mini" onClick={s.addLayer}>＋</button>
                <button className="mini" onClick={() => s.addShapeLayer()}>シェイプレイヤー追加</button>
                <button className="mini" onClick={() => s.addVectorLayer()}>ベクターレイヤー追加</button>
                <button className="mini" disabled={!canMaskActive || !activeLayer}
                  onClick={() => activeLayer && s.addLayerMask(activeLayer.id)}>マスク追加</button>
                <button className="mini" disabled={!activeLayer?.mask}
                  onClick={() => activeLayer && s.removeLayerMask(activeLayer.id)}>マスク削除</button>
                <button className="mini" onClick={s.addGroup}>グループ</button>
              </span>
            </h3>
            <label className="check mask-edit-toggle">
              <input
                type="checkbox"
                checked={s.maskEditMode}
                disabled={!canMaskActive}
                onChange={(e) => s.setMaskEditMode(e.target.checked)}
              />
              マスク編集
              <span>{s.maskEditMode ? 'キャンバス描画はマスクに作用' : '通常描画'}</span>
            </label>
            {activeShapeData && (
              <div className="layer-effects">
                <h4>シェイプ種類</h4>
                <div className="layer-effect-grid">
                  {SHAPE_KIND_OPTIONS.map((item) => (
                    <button
                      key={item.kind}
                      className="mini"
                      aria-pressed={activeShapeData.shape === item.kind}
                      onClick={() => s.updateActiveShapeLayer({ shape: item.kind })}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="layer-effects">
              <h4>レイヤー効果</h4>
              <div className="layer-effect-grid">
                {LAYER_EFFECT_BUTTONS.map((item) => (
                  <button
                    key={item.kind}
                    className="mini"
                    disabled={!canFilterActive}
                    onClick={() => s.applyLayerEffect(item.kind)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
            <ul>
              {[...s.doc.layers].reverse().map((l) => (
                <li key={l.id} className={l.id === s.doc.activeLayerId ? 'layer active' : 'layer'}
                  onClick={() => s.selectLayer(l.id)}>
                  <input type="checkbox" checked={l.visible}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => s.setLayerProps(l.id, { visible: e.target.checked })} />
                  {l.kind === 'adjustment' && (
                    <span className="layer-kind" title="調整レイヤー">
                      {l.adjustment?.type ?? 'adjustment'}
                    </span>
                  )}
                  {l.kind === 'group' && <span className="layer-kind" title="グループ">group</span>}
                  <span className="name">{l.name}</span>
                  {l.mask && <span className="mask-indicator" title="レイヤーマスクあり">MASK</span>}
                  <select value={l.blendMode}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => s.setLayerProps(l.id, { blendMode: e.target.value as BlendMode })}>
                    {BLEND_MODES.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                  <button className="mini" onClick={(e) => { e.stopPropagation(); s.removeLayer(l.id); }}>🗑</button>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
