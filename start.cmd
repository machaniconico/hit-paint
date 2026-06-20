@echo off
REM HIT Paint 起動用ショートカット (Windows)
REM 依存が無ければ npm install し、開発サーバを起動して既定ブラウザで開く。
REM   使い方:  start.cmd           開発サーバ (http://localhost:5173)
REM            start.cmd build     本番ビルド -> dist\
REM            start.cmd preview   ビルド結果をプレビュー
setlocal
cd /d "%~dp0"

if not exist node_modules (
  echo [HIT Paint] 依存パッケージを導入します ^(npm install^)...
  call npm install
)

set "mode=%~1"
if "%mode%"=="" set "mode=dev"

if /i "%mode%"=="dev" (
  echo [HIT Paint] 開発サーバを起動します -^> http://localhost:5173
  start "" http://localhost:5173
  call npm run dev
) else if /i "%mode%"=="build" (
  echo [HIT Paint] 本番ビルドを実行します -^> dist\
  call npm run build
) else if /i "%mode%"=="preview" (
  echo [HIT Paint] ビルド結果をプレビューします
  call npm run preview
) else (
  echo 使い方: start.cmd [dev^|build^|preview]
  exit /b 1
)
endlocal
