# HIT Paint

CLIP STUDIO PAINT / Photoshop 系のレイヤー対応ラスターペイントアプリ（Web / Vite + React + TypeScript）。
クリスタ(`.clip`)と Photoshop(`.psd`)のデータ形式に対応することを主眼に設計しています。

## 起動

```bash
npm install
npm run dev        # 開発サーバ (http://localhost:5173)
npm run build      # 本番ビルド -> dist/
npm run preview    # ビルド結果のプレビュー
npm test           # vitest (955 tests)
npm run typecheck  # tsc --noEmit
```

### ワンクリック起動ショートカット

依存導入〜開発サーバ起動〜ブラウザ表示までを一発で行うショートカットを同梱しています。

```bash
./start.sh         # WSL / Linux / macOS : npm install (初回のみ) -> dev サーバ -> ブラウザを開く
./start.sh build   # 本番ビルド  /  ./start.sh preview でプレビュー
```

```bat
start.cmd          :: Windows : 同上 (ダブルクリックでも起動可)
start.cmd build    :: build / preview も同様
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
- **3D LUT カラーグレーディング** — 3次元LUTモデルとトライリニア補間適用(`color/lut` の `Lut3D`/`sampleLutTrilinear`/`applyLut`、
  格子点厳密一致・α不変)、Adobe/IRIDAS `.cube` の読み書き(`io/cube` の `parseCubeLut`/`writeCubeLut`、
  LUT_3D_SIZE/DOMAIN_MIN/MAX 対応・ラウンドトリップ)、組み込みプリセット手続き生成(`color/lut-presets` の
  warm/cool/sepia/contrastS(S字トーン)/monochrome)。store/UI に `.cube`取込・プリセット選択・LUT適用(Undo対応)・`.cube`書き出しを配線。
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
- **ブラシダイナミクス拡張** — 1打点ごとのカラーダイナミクス(`engine/brush-color-dynamics` の HSV 決定論ジッタ+前景背景ブレンド、
  全振幅0でバイト同一)、デュアルブラシ(`engine/dual-brush` の二次テクスチャで主ブラシαを multiply/subtract/min/screen 変調・非破壊)、
  エアブラシ滞留ビルドアップ(`engine/airbrush` の指数飽和 `buildupAlpha`/`accumulateDwell`、滞留が長いほど濃く・上限飽和)。
  `BrushSettings` に optional 追加し store の打点処理(色決定/αバッファ変調/被覆蓄積を純粋ヘルパに分離)へ配線、UI スライダ追加。未指定は従来とバイト同一。
- **アニメーション** — コマ撮りフレームのタイムライン管理(`anim/timeline` の追加/複製/並べ替え)と
  オニオンスキン合成(前後フレームを低不透明度で重ねる)。store/UI 配線済み(フレーム追加・移動・
  削除・オニオン切替、フレーム間で画素バッファ非共有)。
- **アニメーション書き出し&補間** — キーフレーム中割り(`anim/tween` の13種イージング linear/quad/cubic/sine/back
  と `tweenFrames` で2フレーム間の opacity 等を補間生成)、アニメ GIF 書き出し(`io/gif` の `encodeGif`
  = グローバルパレット量子化 + 可変長 LZW + NETSCAPE2.0 ループ拡張、自前 `decodeGifLzw` でラウンドトリップ検証)、
  再生タイミング(`anim/playback` の `frameTimings`/`resolveFrameAt`、1回/ループ/往復(pingpong)モード)。
  store/UI に中割り・GIF 書き出し・再生モード切替を配線(既存タイムライン挙動は不変)。
- **色変換 / モーションブラー** — RGB↔HSL 変換と色温度・色合い調整(`color/convert`)、
  方向性モーションブラーと放射(ズーム)ブラー(`filters/motion-blur`)。
- **アンシャープ / 色置換** — 輪郭強調のアンシャープマスク(`filters/unsharp`、threshold付き)、
  特定色の置換(`filters/replace-color`、tolerance/fuzziness で柔らか境界)。フィルターメニュー配線済み。
- **液状化 / レンズ / ビネット** — 液状化ツール(`tools/liquify` の push/bloat/pinch、ツールバー配線済み)、
  レンズ歪み(`filters/lens` の樽型/糸巻き型)、周辺減光ビネット(`filters/vignette`、着色対応)。
  ヒストグラム等化・ガンマ・モーション/放射ブラー・レンズ歪み・ビネットもフィルターメニューに配線済み。
- **ベクターパス** — 三次ベジェのパス平坦化と塗り/ストロークのラスタライズ(`vector/path`)。
  複合パス塗り(`rasterizeFillCompound`、evenodd/nonzero 巻き数規則で穴あき図形に対応)と
  破線ストローク(`rasterizeDashedStroke`、弧長ベースの dash パターン)もサポート。
- **ベクターレイヤー** — 複数サブパス(塗り/線/破線)を保持する再編集レイヤー(`vector/vector-layer`、
  `kind:'raster'` + `vectorData`)。編集で再ラスタライズ、Undo はデータごと復元、CLIP 往復で永続化。
- **スマートシェイプ** — 矩形/角丸矩形/楕円/多角形/星/線のパラメトリック図形(`vector/shape`、
  `shapeData`)。シェイプツールでドラッグ生成、種別切替/パラメータ編集で非破壊に再ラスタライズ、CLIP 永続化。
- **ガウシアン / ブルーム** — 真の分離可能ガウシアンぼかし(`filters/gaussian`、α重み付けで透明縁の滲み防止)、
  高輝度部の発光ブルーム(`filters/bloom`)。チャンネルミキサー(`filters/channel-mixer`)と
  クラリティ(`filters/clarity`)もフィルターメニューに配線済み。
- **パス簡略化 / 変換** — Douglas-Peucker 簡略化と AABB/平行移動/拡縮ユーティリティ(`vector/simplify`)。
- **変位マップ / ハーフトーン / ノイズ** — R/G を変位に使う displacement map(`filters/displace`、bilinear)、
  網点スクリーンのハーフトーン(`filters/halftone`)、決定論的な value noise/fbm 生成(`engine/perlin`)。
- **色収差 / 油彩 / パース変形** — radial な色収差(`filters/chromatic`)、エッジ保持の油彩 Kuwahara(`filters/oil`)、
  ホモグラフィによる4点パースペクティブ変形(`tools/perspective`、逆写像 bilinear)。
- **セルラーノイズ / デュオトーン / クロマキー** — 決定論的 Worley(F1)ノイズ(`engine/cellular`)、
  輝度→2色マッピングのデュオトーン(`filters/duotone`)、色距離でアルファを抜くクロマキー(`filters/chromakey`)。
- **スケッチ / 適応しきい値 / メッシュワープ** — color dodge 法の鉛筆スケッチ(`filters/sketch`)、
  局所平均ベースの適応的2値化(`filters/adaptive-threshold`)、N×M 格子のメッシュワープ(`tools/mesh-warp`)。
- **SVG書き出し / グラデ生成 / 自動WB** — shape/vector レイヤーの SVG エクスポート(`io/svg`)、
  多段 linear/radial/conic グラデーション生成(`engine/gradient`)、gray-world 自動ホワイトバランス(`filters/white-balance`)。
- **JSONプロジェクト / 代表色抽出 / 万華鏡** — 全レイヤーをポータブルな JSON で保存・復元(`io/project`、pixels/mask を base64 で round-trip)、
  画像からの代表色スウォッチ抽出(`color/swatches`)、ラジアル対称の万華鏡マッピング(`tools/kaleidoscope`)。
- **スプライトシート / 除霧 / クローンスタンプ** — アニメフレームの格子合成スプライトシート(`anim/sprite-sheet`)、
  dark channel prior による除霧(`filters/dehaze`)、領域複製のクローンスタンプ(`tools/clone-stamp`、フォールオフ/不透明度)。
- **ガイド / セレクティブカラー / テクスチャブラシ** — ガイド・グリッド・スナップ(`core/guides`)、
  色域別 HSL 調整のセレクティブカラー(`filters/selective-color`)、テクスチャ/散布ブラシ先端生成(`engine/brush-texture`)。
- **CLIP配布ブラシ(.sut)取り込み** — CLIP STUDIO の `.sut`(SQLite)を解析してブラシ設定を取り込み(`io/sut`、サイズ/不透明度/フロー/硬さ/間隔等を `BrushSettings` へマッピング)、
  先端 PNG 画像を抽出(`io/sut-tip`、TAR/PNG スキャン)、名前付きブラシプリセットとして登録(`engine/brush-presets`)。CLIP 独自エンジンの完全再現ではなく近似取り込み。
- **CLIP配布ブラシの実描画化** — 取り込んだ `.sut` の先端画像を実際の描画に反映。先端 PNG を 0..1 アルファ化(`engine/tip-stamp` の `pngRgbaToTipAlpha`、CLIP の黒=インク慣習対応)し、
  最長辺=サイズでアスペクト保持スケール・回転・bilinear・max-combine でカバレッジへスタンプ(`stampTip`)、spacing 間隔で経路に連打(`engine/stroke-stamp`)。
  筆圧カーブ(`io/sut-pressure`、署名 `[12][N][16]+float64BE`)をデコードしてサイズ/フローへ適用。SQLite 全体走査の偽陽性カーブは単調性ガード(`curveLooksLikePressureResponse`)で除外。
  先端を持たない `.sut` は従来の数式ブラシにフォールバック(後方互換、バイト不変)。
- **tip ブラシの描き味向上** — 先端画像のストローク方向追従回転 + 決定論的角度ジッタ(`engine/stroke-stamp` の `tipStampAngle`、seed/step ベースの自前 PRNG)、
  散布/スプレー(`engine/tip-scatter` の `scatterOffsets`/`stampScatteredTip`、面積一様の円盤分布)。`.sut` の回転/スプレー設定を `BrushSettings`
  (`tipAngle`/`tipScatter`/`tipScatterDensity` 等)へマッピングし、ライブ描画エンジンと UI(方向追従トグル・散布スライダ)に配線。tip 無しブラシはバイト不変。
- **tip ブラシ忠実度の仕上げ** — `stampStroke` の分割呼び出しジッタ連続性(`stepIndexStart`/`nextStepIndex` で分割=一括一致)、
  spray ON の `.sut` で散布が必ず効く density 写像(下限2)と基準回転/角度ジッタの UI スライダ、
  筆圧 Effector の厳密スコープ抽出(`io/sut-pressure` の `findEffectorCurves`/`selectBrushPressureCurves`、前段 u32 レイアウト実ファイル検証済み・偽陽性を構造的に除外)、
  対称描画での tip 回転鏡映(`engine/symmetry` の `mirrorPointsWithMeta`、flip/rotate メタで各ミラー点の実回転を導出)。
- **tip ブラシ忠実度の最終仕上げ** — Effector カーブの (x,y) ペア正規化・等間隔再サンプル(`io/sut-pressure` の `resampleEffectorCurve`、非一様 x 配置のカーブ形状を正確化、`selectBrushPressureCurves({normalize})` で opt-in・既定はバイト同一)、
  キラル(非対称)tip の真の鏡映(`engine/tip-stamp`/`engine/tip-scatter` の `flipX`、tip 空間横反転を回転前に合成・未指定はバイト同一)を store の対称描画へ配線(`flip→flipX` + pointRotation 幾何補正で回転済みスタンプの真の鏡像)、
  基準回転スライダの負値/360超正規化(`App` の `normalizeDeg`、表示のみ・setBrush ラジアンは不変)。
- **レイヤー効果(拡張)** — ドロップシャドウ/縁取り/光彩に加え、インナーシャドウと
  ベベル・エンボス(`core/layer-effects` の `innerShadow`/`bevelEmboss`、純粋関数・ソース内部限定)。
- **減色 / リサンプル / パターン** — メディアンカット減色(`filters/quantize`、フィルターメニュー配線済み)、
  nearest/bilinear リサンプル(`tools/resample`)、繰り返しタイル塗りとシームレス化(`tools/pattern`)。
- **ペンツール / 液状化 / トーン** — ベジェのペンツール(`tools`+`vector/path`、塗り/線で確定・選択尊重・Undo)、
  液状化ワープ(`tools/liquify` の push/bloat/pinch)、ヒストグラム等化とガンマ補正(`filters/tone`)。
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
              resample(拡縮) / pattern(タイル・シームレス) / liquify(液状化)
  text/       font5x7(ビットマップフォント) / text-layer(再編集テキストデータ)
  vector/     path(ベジェ・パスのラスタライズ)
  anim/       timeline(フレーム・オニオンスキン)
  filters/    index(基本フィルター) / curves / color-balance / histogram /
              convolve(エッジ/エンボス) / pixelate / noise / quantize(減色) /
              tone(等化・ガンマ) / motion-blur(方向・放射ブラー) /
              unsharp(アンシャープ) / replace-color(色置換) /
              lens(レンズ歪み) / vignette(ビネット)
  color/      color(RGB<->HSV / hex) / convert(HSL・色温度) / palette(スウォッチ・配色ハーモニー)
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
