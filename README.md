# HIT Paint

CLIP STUDIO PAINT / Photoshop 系のレイヤー対応ラスターペイントアプリ（Web / Vite + React + TypeScript）。
クリスタ(`.clip`)と Photoshop(`.psd`)のデータ形式に対応することを主眼に設計しています。

## 起動

```bash
npm install
npm run dev        # 開発サーバ (http://localhost:5173)
npm run build      # 本番ビルド -> dist/
npm run preview    # ビルド結果のプレビュー
npm test           # vitest (39 tests)
npm run typecheck  # tsc --noEmit
```

## 機能

- **描画エンジン** — スタンプ補間ブラシ。筆圧→サイズ/不透明度（Pointer Events）、傾き取得、
  スペーシング、ソフト/ハード/ピクセル形状。ストロークバッファ方式でダブの重なりムラを防止。
- **レイヤー** — 追加 / 削除 / 並べ替え / 結合(下と結合) / 表示切替 / 不透明度 /
  14種ブレンドモード(normal〜add/subtract) / クリッピングマスク。
- **合成** — W3C準拠のブレンド + ストレートアルファ合成（CPU、テスト可能）。
- **ツール** — ブラシ / 消しゴム / 塗りつぶし(許容値付き flood fill) / スポイト /
  矩形選択 / 投げ縄選択 / 移動 / 手のひら(パン)。選択範囲はマーキー表示・反転・全選択・塗りつぶし対応。
- **ビューポート** — パン(Shift/中ボタン/手のひら) / ホイールズーム / 回転対応の変換行列。
- **Undo/Redo** — 画素スナップショット方式のコマンド履歴。
- **入出力** — 下記。

## データ形式対応

| 形式 | 読み込み | 書き出し | 実装 |
|------|---------|---------|------|
| **PSD** (Photoshop) | ✅ レイヤー・ブレンドモード・不透明度・表示・位置 | ✅ レイヤー込み | `ag-psd` |
| **CLIP** (CLIP STUDIO) | △ 後述 | △ 後述 | `sql.js` (SQLite/WASM) |
| **PNG / JPEG / WebP / GIF** | ✅ 単一レイヤーへ取り込み | ✅ PNG統合書き出し | Canvas |

### `.clip` 対応の正直な範囲

`.clip` は中身が SQLite データベースですが、内部のレイヤー画素は CLIP STUDIO 独自のタイル/オフスクリーン
形式で格納されており、非公開・バージョン依存です。本アプリの方針は以下のとおりです:

- **書き出し (`exportCLIP`)** — 有効な SQLite コンテナに**独自スキーマ**(`hitpaint_meta` /
  `hitpaint_layers`)でレイヤーを完全保存します。**HIT Paint で完全に再読込(往復)できます**が、
  **本物の CLIP STUDIO PAINT では開けません**（CSP 互換の `.clip` 生成は本アプリの対象外）。
- **読み込み (`importCLIP`)** — まず独自スキーマを検出し、あれば完全復元。なければ**本物の CSP `.clip`**
  とみなしてベストエフォート読込（`Canvas` のサイズ、`CanvasPreview` の統合プレビュー画像）を行い、
  「レイヤー構造の完全復元は未対応」と警告を返します。

PSD は実用レベルの相互運用（Photoshop / Krita / GIMP と往復）が可能です。

## アーキテクチャ

```
src/
  types/      共有型契約（単一の真実）
  core/       document(モデル) / compositor(合成) / history(Undo)
  engine/     brush(ストロークエンジン)
  tools/      fill / selection / transform
  color/      RGB<->HSV / hex 変換
  io/         psd / clip / png / files(DLとピッカー)
  state/      store(zustand 統合点)
  ui/         Canvas(描画+入力) / App(UIシェル)
```

## 既知の制約 / 今後

- 合成は CPU 実装。超大判では WebGL 化が望ましい。
- `.clip` の CSP 互換書き出し、レイヤーフォルダ(グループ)UI、ベクター/テキストレイヤー、
  マスク、フィルター類は未実装（モデルには `kind:'group'`/`children` の素地あり）。
- ブラウザ操作レベルのビジュアル QA は実機ブラウザで要確認（型・単体テスト・本番ビルドは緑）。
