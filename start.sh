#!/usr/bin/env bash
# HIT Paint 起動用ショートカット (WSL / Linux / macOS)
# 依存が無ければ npm install し、開発サーバを起動して既定ブラウザで開く。
#   使い方:  ./start.sh           開発サーバ (http://localhost:5173)
#            ./start.sh build     本番ビルド -> dist/
#            ./start.sh preview   ビルド結果をプレビュー
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  echo "[HIT Paint] 依存パッケージを導入します (npm install)..."
  npm install
fi

mode="${1:-dev}"

open_url() {
  local url="$1"
  if command -v xdg-open >/dev/null 2>&1; then xdg-open "$url" >/dev/null 2>&1 || true
  elif command -v open >/dev/null 2>&1; then open "$url" >/dev/null 2>&1 || true
  elif command -v explorer.exe >/dev/null 2>&1; then explorer.exe "$url" >/dev/null 2>&1 || true  # WSL
  fi
}

case "$mode" in
  dev)
    url="http://localhost:5173"
    echo "[HIT Paint] 開発サーバを起動します -> $url"
    ( sleep 2; open_url "$url" ) &
    exec npm run dev
    ;;
  build)
    echo "[HIT Paint] 本番ビルドを実行します -> dist/"
    exec npm run build
    ;;
  preview)
    echo "[HIT Paint] ビルド結果をプレビューします"
    exec npm run preview
    ;;
  *)
    echo "使い方: ./start.sh [dev|build|preview]" >&2
    exit 1
    ;;
esac
