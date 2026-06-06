# HIT Paint

CLIP STUDIO PAINT / Photoshop 系のレイヤー対応ラスターペイントアプリ（Web / Vite + React + TypeScript）。
クリスタ(`.clip`)と Photoshop(`.psd`)のデータ形式に対応することを主眼に設計しています。

## 起動

```bash
npm install
npm run dev        # 開発サーバ (http://localhost:5173)
npm run build      # 本番ビルド -> dist/
npm run preview    # ビルド結果のプレビュー
npm test           # vitest (309 tests)
npm run typecheck  # tsc --noEmit
```

## 機能

- **描画エンジン** — スタンプ補間ブラシ。筆圧→サイズ/不透明度（Pointer Events）、傾き取得、
  スペーシング、ソフト/ハード/ピクセル形状。ストロークバッファ方式でダブの重なりムラを防止。
- **レイヤー** — 追加 / 削除 / 並べ替え / 結合(下と結合) / 表示切替 / 不透明度 /
  14種ブレンドモード(normal〜add/subtract) / クリッピングマスク / レイヤーマスク(8bit被覆) /
  グループ(フォルダ)合成 / 調整レイヤー(非破壊フィルター)。
  グループへの出し入れ・並べ替え(reorder/reparent)はイミュータブルなロジックで提供(`core/group-ops`)。
- **合成** — W3C準拠のブレンド + ストレートアルファ合成（CPU、テスト可能）。
  レイヤーマスク乗算とグループの独立合成に対応。**調整レイヤー**は下層の合成結果へフィルターを
  非破壊適用し、不透明度を効果の強さ・レイヤーマスクを被覆率として尊重する。GL 環境では WebGL2
  合成パスを使用し、非対応環境では CPU 合成へ自動フォールバック(`compositeAuto`)。
- **フィルター** — ガウシアンぼかし / 明るさ・コントラスト / 階調反転 / グレースケール /
  色相・彩度 / レベル補正 / シャープ / しきい値 / ポスタライズ / セピア /
  トーンカーブ(LUT) / カラーバランス / グラデーションマップ / オートレベル・オートコントラスト /
  エッジ抽出(Sobel) / エンボス / 一般畳み込み / モザイク / ノイズ / 整列ディザ。
  選択範囲を尊重し、Undo 可能（純粋関数・テスト可能）。破壊適用に加え、上記の**調整レイヤー**
  として非破壊適用も可能(明るさ・コントラスト/反転/グレースケール/色相・彩度/レベル)。
  ヒストグラム算出(`filters/histogram`)も提供。
- **色調整・ヒストグラム** — `filters/curves`(制御点→256段LUT) / `filters/color-balance`
  (シャドウ/中間/ハイライト別RGBシフト + グラデーションマップ) / `filters/histogram`
  (度数集計・オートレベル・オートコントラスト、アルファ0除外・外れ値クリップ)。
- **レイヤーマスク手描き** — 円形ブラシ(`tools/mask-paint` の `paintMaskDab`/`paintMaskStroke`、
  hardnessでエッジ硬さ、shape(round/soft の smoothstep)・flow を反映)でマスクを直接ペイント。
  UI の「マスク編集」トグル ON でブラシ描画がアクティブレイヤーのマスクに作用する(OFF 時は通常描画)。
- **変換・ドキュメント操作** — レイヤーの左右/上下反転・90/180度回転(`tools/layer-transform`)、
  選択範囲でクロップ・キャンバスサイズ変更(`core/doc-ops`)、不透明境界の算出とレイヤー整列
  (`core/layer-bounds`)。いずれもイミュータブル/Undo 対応で UI 配線済み。
- **レイヤー効果** — ドロップシャドウ / 縁取り(stroke) / 光彩(`core/layer-effects`)。
  アルファ形状から効果を生成し src-over 合成(`applyLayerEffect` で適用、Undo 可能)。
- **ツール** — ブラシ / 消しゴム / 塗りつぶし(許容値付き flood fill) / スポイト /
  矩形選択 / 楕円選択 / 投げ縄選択 / 自動選択(マジックワンド、色域 tolerance + 連結) /
  グラデーション(線形・放射 `tools/gradient`) / 効果ブラシ(ぼかし/シャープ/覆い焼き/焼き込み
  `engine/effect-brush`) / 移動 / 変形 / テキスト(組み込み5x7ビットマップフォント、
  `text/text-layer` で**あとから文字・色・サイズを再編集可能**) / 手のひら(パン)。
  選択範囲はマーキー表示・反転・全選択・塗りつぶしに加え、拡張(grow)・収縮(shrink)・ぼかし(feather)・
  ブール演算(add/subtract/intersect)・矩形/楕円/多角形マスク生成(`tools/marquee`)に対応。
- **描画補助** — 対称・ミラー描画(`engine/symmetry` の水平/垂直/4分割/放射)、
  ブラシダイナミクス(`engine/brush-dynamics` の決定論的サイズ/不透明度ジッター・散布)、
  カラーパレットと配色ハーモニー生成(`color/palette` の補色/類似色/トライアド/テトラード)。
- **アニメーション** — コマ撮りフレームのタイムライン管理(`anim/timeline` の追加/複製/並べ替え)と
  オニオンスキン合成(前後フレームを低不透明度で重ねる)。
- **ベクターパス** — 三次ベジェのパス平坦化と塗り/ストロークのラスタライズ(`vector/path`)。
- **減色 / リサンプル / パターン** — メディアンカット減色(`filters/quantize`、フィルターメニュー配線済み)、
  nearest/bilinear リサンプル(`tools/resample`)、繰り返しタイル塗りとシームレス化(`tools/pattern`)。
- **ビューポート** — パン(Shift/中ボタン/手のひら) / ホイールズーム / 回転対応の変換行列。
- **Undo/Redo** — 画素スナップショット方式のコマンド履歴(テキストレイヤーは textData も復元)。
- **入出力** — 下記。

## データ形式対応

| 形式 | 読み込み | 書き出し | 実装 |
|------|---------|---------|------|
| **PSD** (Photoshop) | ✅ レイヤー・ブレンドモード・不透明度・表示・位置 | ✅ レイヤー込み(マスクはアルファへ焼き込み) | `ag-psd` |
| **CLIP** (CLIP STUDIO) | △ 後述 | △ 後述 | `sql.js` (SQLite/WASM) |
| **PNG / JPEG / WebP / GIF** | ✅ 単一レイヤーへ取り込み | ✅ PNG統合書き出し | Canvas |

### `.clip` 対応の正直な範囲

`.clip` は中身が SQLite データベースですが、内部のレイヤー画素は CLIP STUDIO 独自のタイル/オフスクリーン
形式で格納されており、非公開・バージョン依存です。本アプリの方針は以下のとおりです:

- **書き出し (`exportCLIP`)** — 有効な SQLite コンテナに**独自スキーマ**(`hitpaint_meta` /
  `hitpaint_layers`)でレイヤーを完全保存します（レイヤーマスク・グループの children 構造を含む）。
  **HIT Paint で完全に再読込(往復)できます**が、**本物の CLIP STUDIO PAINT では開けません**
  （CSP 互換の `.clip` 生成は本アプリの対象外）。レイヤー種別(`kind`)と調整レイヤーの設定
  (`AdjustmentSpec`)・再編集テキストレイヤーの `textData` も往復保存します。
  旧スキーマ(mask/kind/adjustment/textData 列なし)は列検出で後方互換読み込みします。
- **読み込み (`importCLIP`)** — まず独自スキーマを検出し、あれば完全復元。なければ**本物の CSP `.clip`**
  とみなしてベストエフォート読込（`Canvas` のサイズ、`CanvasPreview` の統合プレビュー画像）を行い、
  「レイヤー構造の完全復元は未対応」と警告を返します。

PSD は実用レベルの相互運用（Photoshop / Krita / GIMP と往復）が可能です。

## アーキテクチャ

```
src/
  types/      共有型契約（単一の真実）
  core/       document(モデル) / compositor(合成・調整レイヤー) / group-ops(編成) /
              doc-ops(クロップ・リサイズ) / layer-bounds(境界・整列) /
              layer-effects(影/縁取り/光彩) / gpu-compositor(WebGL) / history(Undo)
  engine/     brush(ストローク) / effect-brush(ぼかし/覆い焼き等) /
              symmetry(対称描画) / brush-dynamics(ジッター/散布)
  tools/      fill / selection / transform / mask-paint(マスク手描き) /
              layer-transform(反転・回転) / gradient / magic-wand / marquee(選択形状) /
              resample(拡縮) / pattern(タイル・シームレス)
  text/       font5x7(ビットマップフォント) / text-layer(再編集テキストデータ)
  vector/     path(ベジェ・パスのラスタライズ)
  anim/       timeline(フレーム・オニオンスキン)
  filters/    index(基本フィルター) / curves / color-balance / histogram /
              convolve(エッジ/エンボス) / pixelate / noise / quantize(減色)
  color/      color(RGB<->HSV / hex) / palette(スウォッチ・配色ハーモニー)
  io/         psd / clip / png / files(DLとピッカー)
  state/      store(zustand 統合点)
  ui/         Canvas(描画+入力) / App(UIシェル)
```

## 既知の制約 / 今後

- WebGL2 合成パス(`gpu-compositor`)は normal/multiply/screen のみ対応。それ以外のブレンド・
  クリッピング・マスク付きレイヤーを含む文書は CPU 合成にフォールバックする。GPU パスの実機
  ビジュアル一致は要実機検証(headless テストは CPU フォールバックの parity のみ検証)。
- グループ(フォルダ)は合成・モデル・CLIP 往復・編成ロジック(`group-ops` の reorder/reparent)に
  対応済みだが、UI 上のドラッグ&ドロップでの組み替えは未配線(操作はボタン/アクション経由)。
- テキストは組み込みビットマップフォント。`text-layer` の再編集データ(`TextLayerData`)で文字・色・
  サイズの再編集に対応し UI 配線済みだが、任意 TTF・ベクターフォントは未対応。
- 調整レイヤー(非破壊フィルター)・手描きマスク・変換・レイヤー効果・各種フィルターは
  モデル/ロジック/UI/(該当するものは)CLIP・PSD 往復まで配線済み。`.clip` の CSP 互換書き出しは対象外。
- レイヤー効果(影/縁取り/光彩)は選択範囲ではなくレイヤーのアルファ形状を基準に適用する仕様。
- WebGL2 合成パスは一部ブレンドのみで、それ以外は CPU 合成へフォールバックする(前述)。
- ブラウザ操作レベルのビジュアル QA は実機ブラウザで要確認（型・単体テスト・本番ビルドは緑）。
