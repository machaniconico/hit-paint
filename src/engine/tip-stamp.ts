/**
 * HIT Paint — tip stamping for .sut distribution brushes (US-3801).
 *
 * .sut ブラシは任意形状の「先端(tip)画像」をストロークに沿ってスタンプする。
 * 既存の dabFalloff 系(round/soft/pixel)は数式で falloff を生成するのに対し、
 * ここでは PNG 由来の任意アルファ形状を扱う純粋関数群を提供する。
 *
 * すべて純粋配列(Float32Array)操作のみで完結し、canvas/DOM に依存しない。
 */

/** スタンプ先端のアルファ形状。data: width*height、各要素 0..1(1=完全不透明)。 */
export interface TipAlpha {
  width: number;
  height: number;
  data: Float32Array;
}

/**
 * ストレート RGBA(length=width*height*4)を tip アルファへ変換する。
 *
 * - source 既定 'auto': rgba 内に alpha<255 の画素が1つでもあれば 'alpha'、
 *   無ければ 'luminance' を採用。
 * - 'alpha': data[i] = a/255。
 * - 'luminance': 輝度 L=(0.299r+0.587g+0.114b)/255。CLIP の tip は
 *   「黒=インク」慣習なので data[i] = 1 - L(黒→1, 白→0)。
 * - invert:true なら最終 data を 1-data に反転。
 */
export function pngRgbaToTipAlpha(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  opts?: { source?: 'alpha' | 'luminance' | 'auto'; invert?: boolean },
): TipAlpha {
  const count = width * height;
  const data = new Float32Array(count);

  // 'auto' は半透明画素の有無で alpha / luminance を切り替える。
  let source = opts?.source ?? 'auto';
  if (source === 'auto') {
    let hasTransparency = false;
    for (let i = 0; i < count; i += 1) {
      if (rgba[i * 4 + 3] < 255) {
        hasTransparency = true;
        break;
      }
    }
    source = hasTransparency ? 'alpha' : 'luminance';
  }

  if (source === 'alpha') {
    for (let i = 0; i < count; i += 1) {
      data[i] = rgba[i * 4 + 3] / 255;
    }
  } else {
    for (let i = 0; i < count; i += 1) {
      const r = rgba[i * 4];
      const g = rgba[i * 4 + 1];
      const b = rgba[i * 4 + 2];
      const l = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      // 黒(L=0)→1, 白(L=1)→0。
      data[i] = 1 - l;
    }
  }

  if (opts?.invert) {
    for (let i = 0; i < count; i += 1) {
      data[i] = 1 - data[i];
    }
  }

  return { width, height, data };
}

/** tip 座標 (sx, sy) を bilinear サンプル。範囲外は 0。 */
function sampleTip(tip: TipAlpha, sx: number, sy: number): number {
  const { width, height, data } = tip;
  // 完全に範囲外なら早期 0。
  if (sx < -0.5 || sy < -0.5 || sx > width - 0.5 || sy > height - 0.5) {
    return 0;
  }

  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const fx = sx - x0;
  const fy = sy - y0;

  const at = (xx: number, yy: number): number => {
    if (xx < 0 || yy < 0 || xx >= width || yy >= height) return 0;
    return data[yy * width + xx];
  };

  const v00 = at(x0, y0);
  const v10 = at(x1, y0);
  const v01 = at(x0, y1);
  const v11 = at(x1, y1);

  const top = v00 * (1 - fx) + v10 * fx;
  const bottom = v01 * (1 - fx) + v11 * fx;
  return top * (1 - fy) + bottom * fy;
}

/**
 * tip を coverage バッファへスタンプする。
 *
 * - 中心(x,y)に、最長辺が size[px] になるようアスペクト比保持でスケールし、
 *   rotation[ラジアン, 既定0]回転、flow(既定1, 0..1)を乗算して max-combine
 *   (if(v>coverage[idx]) coverage[idx]=v)で書き込む。
 * - 出力画素中心を逆回転・逆スケールで tip 座標へ写し、bilinear サンプル。
 * - キャンバス境界でクリップ。範囲外書き込み/throw は一切しない。
 * - size<=0 や flow<=0 は no-op。
 *
 * flipX(既定 false): tip 空間の横方向(縦軸まわり)反転。**合成順序は
 * 順変換 = rotate(rotation) ∘ flipX ∘ scale**。つまり flipX は scale の後・
 * rotation の前に適用される(tip 空間内で先に左右反転してから回転させる)。
 * これによりキラル(非対称)な tip でも真の鏡像が得られる。実装は逆変換
 * サンプル側なので、逆回転後の rx を符号反転して tip 座標へ写すだけで済む
 * (sx = (-rx)*invScale + tipCx - 0.5、ry/sy は不変)。
 * symmetry の mirrorPointsWithMeta(変換後角度 = rotate - θ)と組で使うと、
 * 回転済みスタンプ全体の真の鏡像(回転 -θ + flipX)になる。
 */
export function stampTip(
  coverage: Float32Array,
  cw: number,
  ch: number,
  tip: TipAlpha,
  opts: { x: number; y: number; size: number; rotation?: number; flow?: number; flipX?: boolean },
): void {
  const { x, y, size } = opts;
  const rotation = opts.rotation ?? 0;
  const flow = opts.flow ?? 1;
  const flipX = opts.flipX ?? false;

  if (size <= 0 || flow <= 0) return;
  if (tip.width <= 0 || tip.height <= 0) return;

  // tip の最長辺が size になるスケール(tip空間→キャンバス空間の倍率)。
  const longest = Math.max(tip.width, tip.height);
  const scale = size / longest;
  if (scale <= 0) return;

  // キャンバス空間でのスタンプ半サイズ(回転後の AABB)。
  const dstW = tip.width * scale;
  const dstH = tip.height * scale;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  // 回転矩形を内包する軸並行バウンディングボックスの半幅/半高。
  const halfBoxW = (Math.abs(cos) * dstW + Math.abs(sin) * dstH) / 2;
  const halfBoxH = (Math.abs(sin) * dstW + Math.abs(cos) * dstH) / 2;

  // 走査する出力画素範囲をキャンバス境界でクリップ。
  const minX = Math.max(0, Math.floor(x - halfBoxW));
  const maxX = Math.min(cw - 1, Math.ceil(x + halfBoxW));
  const minY = Math.max(0, Math.floor(y - halfBoxH));
  const maxY = Math.min(ch - 1, Math.ceil(y + halfBoxH));

  if (minX > maxX || minY > maxY) return;

  // 逆変換: キャンバス→中心相対→逆回転→逆スケール→tip中心へオフセット。
  const invScale = 1 / scale;
  const tipCx = tip.width / 2;
  const tipCy = tip.height / 2;

  for (let py = minY; py <= maxY; py += 1) {
    const dy = py + 0.5 - y;
    for (let px = minX; px <= maxX; px += 1) {
      const dx = px + 0.5 - x;

      // 逆回転(+rotation で順回転なので逆は -rotation = [cos, sin; -sin, cos])。
      const rx = dx * cos + dy * sin;
      const ry = -dx * sin + dy * cos;

      // 逆スケールして tip 中心へ。tip画素中心が整数+0.5 になるよう -0.5。
      // flipX 時は順変換 flipX が rotate の前(scale の後)に入るので、
      // 逆変換では逆回転で得た rx の符号を反転してから tip 座標へ写す
      // (ry は flipX の影響を受けない)。
      const sx = (flipX ? -rx : rx) * invScale + tipCx - 0.5;
      const sy = ry * invScale + tipCy - 0.5;

      const a = sampleTip(tip, sx, sy);
      if (a <= 0) continue;

      const v = a * flow;
      const idx = py * cw + px;
      if (v > coverage[idx]) coverage[idx] = v;
    }
  }
}
