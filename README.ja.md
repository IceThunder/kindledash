<div align="center">

# KindleDash

**脱獄した Kindle をひとつのダッシュボードで —— すべて Wi‑Fi 経由。**

📚 ライブラリ · 🖥️ 画面ミラーリング · 📊 パフォーマンス · ⚙️ プロセス · 📁 ファイル · ⌨️ root ターミナル

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey)
![UI](https://img.shields.io/badge/UI-English%20%7C%20%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87%20%7C%20%E6%97%A5%E6%9C%AC%E8%AA%9E%20%7C%20%ED%95%9C%EA%B5%AD%EC%96%B4-informational)
![Transport](https://img.shields.io/badge/transport-SSH%20over%20Wi--Fi-success)

[English](README.md) | [简体中文](README.zh-CN.md) | **日本語** | [한국어](README.ko.md)

<!-- TODO: ここにスクリーンショット / GIF を追加すると拡散効果が高まります -->

</div>

---

KindleDash は、**脱獄（ジェイルブレイク）した Kindle** 用のクロスプラットフォーム（macOS / Windows）デスクトップ管理ツールです。SSH で端末と通信するため、USB ケーブルもドライバーも不要。ライブラリブラウザー、電子インク画面のライブ表示、パフォーマンス監視、プロセス管理、フル機能のファイルマネージャー、root ターミナルをひとつのウィンドウにまとめて提供します。

実際の Kindle Paperwhite（ファームウェア 5.6.1.1、カーネル 2.6.31-rt11-lab126）で開発・検証しています。機種ごとの互換性メモは[こちら](docs/机型适配调研.md)（中国語）。

## ✨ 機能

### 📚 ライブラリ
- 端末内のすべての書籍をカバー付きグリッドで表示 —— タイトル / 著者 / ASIN / 出版社 / 形式 / サイズ
- 検索・ソート・形式による絞り込み
- 新しい本のアップロード、PC へのダウンロード、削除時に `.sdr` 副フォルダーも自動クリーンアップ
- MOBI/AZW3 の EXTH メタデータを解析して埋め込み表紙を抽出。カバーはローカルにキャッシュされ、2 回目のスキャンは一瞬で開きます

### 🖥️ 画面ミラーリング
- 電子インク画面をライブ表示：更新間隔 0.5〜5 秒（調整可能）、手動リフレッシュ、スクリーンショット保存
- 画面が実際に変化したときだけ転送 —— 静止した電子インク画面は 1 フレーム約 20 KB
- 切断時は最後のフレームを保持し、ウィンドウサイズに合わせて自動スケール

### 📊 概要とパフォーマンス
- 端末情報：モデル / ファームウェア / シリアル番号 / ハードウェア・基板
- リアルタイムの CPU グラフ、メモリ内訳、ロードアベレージ、バッテリー（容量 / 電圧 / 温度 / 電流）、パーティションごとのストレージ
- バッテリー / 温度 / 稼働時間のリングゲージ
- 端末の再起動

### 🧹 ジャンククリーンアップ
- 孤立した `.sdr` 注釈フォルダー、システム残留ファイル、一時ファイルをスキャン
- チェック → 確認 → してから削除。自動クリーンアップは一切行いません

### ⚙️ プロセス / スレッド
- 全プロセス一覧：CPU% / RSS / 状態 / スレッド数
- スレッド単位の CPU 使用率（`/proc` の 2 回サンプリング差分）、プロセスの強制終了

### 📁 ファイルマネージャー
- フル機能の SFTP ブラウザー：アップロード / ダウンロード / 新規作成 / 名前変更 / 再帰削除 / テキストプレビュー —— 転送の進捗も表示

### ⌨️ リモートターミナル
- 端末上の root シェル（xterm.js）。ほかのことはすべてここで

## 🔌 ハイライト

- **頑丈な接続** —— 切断時は自動再接続（最大 30 回 × 5 秒）、ポーリングを直列化してチャネル滞留を防止、接続中は Kindle の自動スリープを阻止（設定でオフ可能）
- **複数端末管理** —— 複数の Kindle のプロファイルを保存して切り替え。端末ごとに独立したライブラリキャッシュ
- **端末にやさしい** —— すべてのポーリングを 1 往復の SSH に統合。接続設定は永続化され、起動時に自動接続
- **4 言語 UI** —— 簡体中文 / English / 日本語 / 한국어、システム言語から自動検出

## 🚀 始めかた

### 必要環境
- SSH が有効（ポート 22）で root 権限（秘密鍵またはパスワード）のある脱獄済み Kindle
- 端末と PC が同じネットワーク上にあること
- 開発用：Node.js ≥ 18

### 接続
1. KindleDash を起動し、左下の**「接続設定」**を開きます。
2. Kindle の IP アドレスを入力します（端末の Wi-Fi 設定で確認できます）。
3. 秘密鍵かパスワードを選択 —— 以上です。設定は保存され、次回起動時に自動接続します。

> ヒント：Kindle は ICMP をブロックしているため `ping` が通らなくても正常です。KindleDash は TCP で SSH ポートに直接接続します。

### インストール / ビルド

[Releases](https://github.com/IceThunder/kindledash/releases) からビルドを入手するか、自分でビルド：

```bash
npm install
npm run dev        # 開発モード（ホットリロード）
npm run dist:mac   # macOS dmg（Apple Silicon）
npm run dist:win   # Windows x64 インストーラー + ポータブル版（Windows 上で実行）
```

<details>
<summary>開発向け詳細</summary>

```bash
npm run typecheck  # TypeScript チェック
npm run build      # 本番ビルド（out/）
```

実機に対するバックエンド統合テスト（UI なし）：

```bash
KINDLE_HOST=192.168.x.x KINDLE_KEY=~/.ssh/your-key.pem npx tsx src/test-integration.ts
```

**macOS XProtect について**：新しい macOS は npm が入手した未署名の Electron バイナリを削除することがあります（症状：`node_modules/electron/dist/Electron.app` が消える、`npm run dev` が ENOENT やサイレント終了）。対処：

```bash
cd node_modules/electron && node install.js
codesign --force --deep --sign - dist/Electron.app
```

プロジェクト構成：

```
src/
├── main/               # Electron メインプロセス
│   ├── index.ts        #   ウィンドウ / IPC / ポーリングスケジューラー / ターミナルチャネル
│   ├── kindle.ts       #   SSH 接続管理（自動再接続 / exec / SFTP / shell）
│   ├── stats.ts        #   /proc 解析（CPU / メモリ / プロセス / 端末情報）
│   ├── screen.ts       #   画面キャプチャ（gzip 転送 → 展開 → 切り出し → 変化検出）
│   ├── library.ts      #   ライブラリスキャン + メタデータ
│   ├── mobi.ts         #   MOBI/AZW3 EXTH 解析 / 表紙抽出
│   ├── cleanup.ts      #   ジャンクスキャン
│   ├── files.ts        #   SFTP ファイル操作（アップロード / ダウンロード / 進捗）
│   ├── settings.ts     #   アプリ設定
│   └── i18n.ts         #   メインプロセス i18n
├── preload/index.ts    # contextBridge
├── renderer/src/       # React UI
└── shared/             # 共有型 + 4 言語辞書
```

</details>

## 📱 対応端末

画面ミラーリングは 758×1024 @ 8bpp パネル（Paperwhite 世代）に合わせて調整済み。解像度とピクセル形式は `src/main/screen.ts` 先頭の定数で変更できます（PW3/Voyage は 1072×1448）。それ以外の機能は汎用の `/proc` と SFTP を使うため、他の Kindle モデルでも動作します。調査メモ：[docs/机型适配调研.md](docs/机型适配调研.md)（中国語）。

## 🙏 謝辞

画面処理と機種データは [FBInk](https://github.com/NiLuJe/FBInk)、[KOReader](https://github.com/koreader/koreader)、[MobileRead コミュニティ](https://www.mobileread.com/forums/)の成果を参考にしています。

## 📄 ライセンス

[MIT](LICENSE) —— 自由に使用・改変・配布できます。本プロジェクトは、自分が所有する脱獄済み Kindle 端末の管理を目的としています。

---

役に立ったと思ったら ⭐ スターとシェアをお願いします —— ほかの Kindle ユーザーにも届きます。
