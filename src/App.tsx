import { useState } from 'react';
import { useStore } from './state/store';
import { Canvas } from './ui/Canvas';
import { rgbaToHex, hexToRgba } from './color/color';
import type { AdjustmentSpec, BlendMode, ToolId } from './types';
import { BLEND_MODES } from './types';
import { importPSD, exportPSD } from './io/psd';
import { importCLIP, exportCLIP } from './io/clip';
import { exportPNG, importImageFile } from './io/png';
import { pickFile, downloadBlob } from './io/files';

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
  { id: 'text', label: 'テキスト', key: 'T' },
  { id: 'eyedropper', label: 'スポイト', key: 'I' },
  { id: 'select-rect', label: '矩形選択', key: 'M' },
  { id: 'move', label: '移動', key: 'V' },
  { id: 'transform', label: '変形', key: 'R' },
  { id: 'pan', label: '手のひら', key: 'H' },
];

const ADJUSTMENT_TYPES: { type: AdjustmentSpec['type']; label: string; opts?: Record<string, number> }[] = [
  { type: 'brightness-contrast', label: '明るさ・コントラスト', opts: { brightness: 10, contrast: 10 } },
  { type: 'invert', label: '階調反転' },
  { type: 'grayscale', label: 'グレースケール' },
  { type: 'hue-saturation', label: '色相・彩度', opts: { hue: 0, saturation: 20 } },
  { type: 'levels', label: 'レベル', opts: { inBlack: 16, inWhite: 239, gamma: 1, outBlack: 0, outWhite: 255 } },
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
  const [blurRadius, setBlurRadius] = useState(4);
  const activeLayer = s.doc.layers.find((l) => l.id === s.doc.activeLayerId);
  const canFilterActive = Boolean(activeLayer?.pixels && activeLayer.kind === 'raster' && !activeLayer.locked);
  const canMaskActive = Boolean(activeLayer?.pixels && activeLayer.kind === 'raster');

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
            if (s.tool !== 'text') return;
            e.preventDefault();
            e.stopPropagation();

            const rect = e.currentTarget.getBoundingClientRect();
            const point = screenToDoc(e.clientX - rect.left, e.clientY - rect.top, s.viewport);
            const text = window.prompt('テキストを入力');
            if (text) s.placeTextAt(point.x, point.y, text);
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
            <h3>塗りつぶし</h3>
            <label>許容値 <b>{s.fillTolerance}</b>
              <input type="range" min={0} max={255} value={s.fillTolerance}
                onChange={(e) => s.setFillTolerance(+e.target.value)} />
            </label>
            <button className="mini wide" onClick={s.fillSelectionWithPrimary}>
              {s.doc.selection ? '選択範囲を描画色で塗る' : 'レイヤーを描画色で塗る'}
            </button>
          </section>

          <section className="panel filters">
            <h3>フィルター</h3>
            <label>ぼかし半径 <b>{blurRadius}px</b>
              <input type="range" min={1} max={24} value={blurRadius}
                onChange={(e) => setBlurRadius(+e.target.value)} />
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
                onClick={() => s.applyFilter('sharpen', { amount: 0.75 })}>シャープ</button>
              <button className="mini" disabled={!canFilterActive}
                onClick={() => s.applyFilter('threshold', { level: 128 })}>しきい値</button>
              <button className="mini" disabled={!canFilterActive}
                onClick={() => s.applyFilter('posterize', { levels: 4 })}>ポスタライズ</button>
              <button className="mini" disabled={!canFilterActive}
                onClick={() => s.applyFilter('sepia')}>セピア</button>
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
              <button className="mini" disabled={!s.doc.selection}
                onClick={() => s.growSelectionBy(4)}>拡張</button>
              <button className="mini" disabled={!s.doc.selection}
                onClick={() => s.shrinkSelectionBy(4)}>収縮</button>
              <button className="mini" disabled={!s.doc.selection}
                onClick={() => s.featherSelectionBy(4)}>ぼかし</button>
            </div>
          </section>

          <section className="panel layers">
            <h3>
              レイヤー
              <span className="layer-actions">
                <button className="mini" onClick={s.addLayer}>＋</button>
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
