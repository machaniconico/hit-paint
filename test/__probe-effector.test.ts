// 一時調査用 probe(後で削除)。実 .sut の Effector レコードの実態を調べる。
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import {
  curveIsFlat,
  curveLooksLikePressureResponse,
  findEffectorCurves,
  findPressureCurves,
} from '../src/io/sut-pressure';

const assetDir = join(process.cwd(), 'assetpass');
const sutFiles = existsSync(assetDir)
  ? readdirSync(assetDir).filter((f) => f.endsWith('.sut'))
  : [];

describe.skipIf(sutFiles.length === 0)('probe', () => {
  it('dumps effector records of every real .sut', () => {
    for (const f of sutFiles) {
      const blob = new Uint8Array(readFileSync(join(assetDir, f)));
      const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
      const effs = findEffectorCurves(blob);
      console.log(`=== ${f}: ${effs.length} effectors ===`);
      // 各 effector の pairs を再構成してダンプ
      // findEffectorCurves はオフセットを返さないので再走査
      for (const eff of effs) {
        const n = eff.curve.points.length;
        const legacyPass =
          eff.enabled && !curveIsFlat(eff.curve) && curveLooksLikePressureResponse(eff.curve);
        console.log(
          `  N=${n} enabled=${eff.enabled} src=${eff.inputSource} range=${eff.range} off=${eff.offset} legacyGuardPass=${legacyPass} prefix=[${eff.curve.points.map((p) => p.toFixed(3)).join(',')}]`,
        );
      }
      const legacy = findPressureCurves(blob).filter(
        (c) => !curveIsFlat(c) && curveLooksLikePressureResponse(c),
      );
      console.log(`  legacy store filter count=${legacy.length}`);
      // pairs の中身: effector のカーブ署名位置を自前走査してペアをダンプ
      for (let i = 32; i + 12 <= blob.length; i++) {
        if (view.getUint32(i, false) !== 12) continue;
        const n = view.getUint32(i + 4, false);
        if (n < 1 || n > 64) continue;
        if (view.getUint32(i + 8, false) !== 16) continue;
        if (view.getUint32(i - 16, false) !== 12 + 16 * n) continue;
        if (view.getUint32(i - 20, false) !== 0) continue;
        if (view.getUint32(i - 4, false) !== 0) continue;
        const body = i + 12;
        if (body + n * 16 > blob.length) continue;
        let ok = true;
        const pairs: Array<[number, number]> = [];
        for (let k = 0; k < n; k++) {
          const x = view.getFloat64(body + k * 16, false);
          const y = view.getFloat64(body + k * 16 + 8, false);
          if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
            ok = false;
            break;
          }
          pairs.push([x, y]);
        }
        if (!ok) continue;
        console.log(
          `  @${i} pairs=[${pairs.map(([x, y]) => `(${x.toFixed(3)},${y.toFixed(3)})`).join(' ')}]`,
        );
      }
    }
  });
});
