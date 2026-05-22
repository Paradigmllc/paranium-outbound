<!-- GitHub Copilot Instructions — Paradigm Projects -->
<!-- このファイルは docs/ai-rules-coding.md から自動生成されます。直接編集しないこと。 -->

# Paradigm Coding Rules — All AI Agents

> すべての AI エージェント（Claude Code / Cursor / Cline / OpenAI Codex 等）はこのルールに従うこと。
> このファイルは `docs/ai-rules-coding.md` が正本。直接編集し `bash sync.sh deploy-ai-rules` で各ツールに展開する。

---

## 🚨 禁止事項 10 箇条（最優先・例外なし）

| # | 禁止行為 | 代わりにすること |
|---|---------|---------------|
| 1 | `catch {}` / `catch(e) {}` の握りつぶし | `toast.error(e.message)` + `console.error(e)` を必ず追加 |
| 2 | `alert()` / `confirm()` / `prompt()` 使用 | Sonner toast / shadcn Dialog を使用 |
| 3 | `git push --force` | 絶対禁止。ユーザーに確認を求める |
| 4 | `git reset --hard` | `git stash` などの安全な代替手段を提案 |
| 5 | `process.env.X \|\| ""` 空文字フォールバック | 未設定時は明示的エラーログを出力 |
| 6 | `as any` の多用（3箇所以上） | `unknown` + 型ガード、または明示型を使用 |
| 7 | 1 ファイル 500 行超え | 責務ごとにコンポーネント / フック / ユーティリティに分割 |
| 8 | API のみ / GUI のみの実装 | DB + API + GUI の 3 点セットで必ず実装 |
| 9 | コード変更後に確認なくタスク完了とする | commit → push → deploy → URL 確認まで完了とする |
| 10 | 外部 URL に `target="_blank"` なし | `target="_blank" rel="noopener noreferrer"` を必ず付与 |

---

## 🏗️ 実装品質（A〜I）

**A. DB・API・GUI の 3 点セット必須**
機能追加は DB スキーマ + API エンドポイント + UI を必ずセットで実装する。API のみ・GUI のみは禁止。

**B. 全機能の 5 点セット**
API + GUI + リアルタイム可視化 + エラー可視化 + 全データ DB 化。
進捗バー・成功 / エラー toast・ベル通知・ハードコード禁止を必ず実装。

**C. ページ間は動的データ連携**
単なるページ遷移ではなく URL パラメータ・共有 state・DB 経由の双方向同期で連携
（`?prompt=` / `?tab=` / `?mode=` / `?topic=` / `?media_url=`）。

**D. 実行結果をリアルタイム可視化**
機能追加時は成果・進捗をダッシュボード上に即時反映する。

**E. エラーハンドリング必須**
`catch {}` の握りつぶし禁止。エラーは必ず `toast.error()` + `console.error()` + 可能であれば DB 保存で可視化する。

**F. ファイル分割ルール**
1 ファイル 300 行超えで分割検討、500 行超えで分割必須。
責務ごとにコンポーネント・フック・ユーティリティに分離する（mega ファイル禁止）。

**G. TypeScript 型安全**
`any` / `as any` の多用禁止。`unknown` + 型ガード、または明示的な型定義を使用。
定数は `as const` でタプル型に固定する。

**H. 完了の定義**
ローディング状態・空状態（EmptyState）・エラー状態の 3 つを必ず実装してからタスク完了とする。

**I. 新ライブラリ追加前に既存確認**
`package.json` を確認して類似・重複ライブラリがないか先にチェック。
既存で実現できる場合は追加しない。

---

## 🎨 UI/UX（J〜M）

**J. モダン JS ライブラリ（Tier S 必須）**

| Tier | ライブラリ |
|------|-----------|
| S（全案件必須） | framer-motion / shadcn/ui+Radix / Magic UI / TanStack Query+Table / Zustand / Recharts+Tremor / React Hook Form+Zod / Sonner / dnd kit / Tailwind CSS |
| A（SaaS/LP 積極採用） | typewriter-effect / tsparticles / react-countup / embla-carousel / react-resizable-panels / vaul / @formkit/auto-animate |
| B（用途別） | react-confetti / lottie-react / react-colorful / react-activity-calendar |

shadcn 統合が必要なもの（直接 npm install 禁止）:
- `npx shadcn@latest add carousel` / `resizable` / `drawer`

**K. Stripe Dashboard UI スタイル**
クリーン白地・明確な情報階層・カード型・色使い控えめ・重要情報強調。

**L. レスポンシブ + モバイル戦略は実装と同時に完了**
コンポーネント作成時に `sm:` `md:` `lg:` を必ず設定。PWA 対応（manifest.json + service worker）推奨。

**M. UI デザインは既存ページに統一**
新実装前に既存ページを読み込んで確認し、共通コンポーネントを積極的に再利用する。
独自 UI を一から作る前に「既存で流用できるものがないか」を必ず確認する。

---

## 📣 通知（N）

**N. 通知は必ず DB ベル + Slack の両方**
片方だけは NG。`notifyBothChannels(s, {title, message, link, type})` を全 API で使用。
顧客向け SaaS は LINE 通知も追加必須（Slack は社内向け・LINE は顧客向け）。

---

## 🔒 品質・セキュリティ（Z, AA〜CC, LL, MM）

**Z. セキュリティ基本原則**
- ユーザー入力は必ずバリデーション・サニタイズ
- SQL はパラメータ化（文字列連結禁止）
- API エンドポイントに認可チェック必須
- 機密情報をログ・レスポンス・URL に含めない
- 依存関係は月 1 回 `npm audit` + `npm outdated` を実行

**AA. パフォーマンス基本原則**
- N+1 クエリ禁止（ループ内 DB アクセスは `.in()` / JOIN でバッチ化）
- 画像は `next/image` + WebP + 適切なサイズ
- リスト 100 件超は仮想スクロール or 無限スクロール
- 重い処理はバックグラウンド API

**BB. ログ・監視の基本**
- `console.log` の本番残留禁止（`console.error` / `console.warn` のみ可）
- 重要な処理は構造化ログで DB 保存
- エラーは必ずユーザーに可視化し、サイレント失敗を作らない
- `alert()` / `confirm()` / `prompt()` 禁止 → `toast.success()` / `toast.error()` / `toast.warning()`（Sonner）

**CC. アクセシビリティ最低限**
- `<img>` に `alt` 必須
- インタラクティブ要素に `aria-label` 付与
- キーボード操作対応（`tabIndex` / `onKeyDown`）
- カラーコントラスト 4.5:1 以上

**LL. テスト基本原則**
共通ユーティリティ・複雑なビジネスロジック・API ルートには最低限ユニットテスト（Vitest 推奨）。
主要ユーザーフローは Playwright で E2E カバー。「テストなしで完了」は禁止。

**MM. Supabase RLS 必須化**
テーブル追加時は RLS を有効化し最小権限ポリシーを設定すること。
`service_role` キー使用のサーバー側 API でも user_id 確認を実装。RLS なしのテーブル公開禁止。

---

## 🤝 開発フロー（DD, QQ）

**DD. ブランチ戦略**
`main` への直接 push は緊急修正のみ。
通常は `feat/xxx` / `fix/xxx` / `hotfix/xxx` ブランチを切って PR 経由でマージ。

**EE. Task.md 進捗同期ルール**
すべてのプロジェクトで、作業進捗・壁打ちの決定事項・引き継ぎは各リポジトリ直下の `Task.md` に集約する。
`AGENTS.md` / `.clinerules` / `.windsurfrules` / `.cursor/rules/global.mdc` は共通ルールの配布物なので、進捗や一時ログを書かない。
長い仕様・監査・設計メモは `docs/refactor/` または `docs/knowledge/` に分離し、`Task.md` からリンクする。
API key・トークン・認証情報の実値は `Task.md` / `docs/` / git 管理ファイルに書かず、必要な環境変数名と用途だけを記録する。
Claude / Codex / Cline / Cursor など複数 AI エージェントで作業する場合は、各エージェントが作業開始前に `Task.md` の CURRENT STATUS / Active Handoff を確認し、終了時に更新する。

**QQ. 実装前に要件すり合わせを必ず行う**
新機能・新ページ・大きな改修を始める前に以下を確認してから実装に入ること:
① フォルダ構成・ファイル配置 ② UI/UX デザイン方針 ③ 技術スタック選定 ④ DB 設計・API 設計の概要。

---

## 🧰 ツール活用（W〜Y）

**W. 車輪の再発明禁止・OSS 優先**
何か機能を実装する前に同等の OSS・MCP・ライブラリが存在しないか必ず調査してから実装に入ること。
「自分で作れる」ではなく「既存で賄えないか」を最初に考える。

**X. エラー発生時は自律調査してから質問**
エラーが発生したら質問する前に:
① エラーメッセージを GitHub Issues / Stack Overflow / 公式ドキュメントで調査
② 類似ケースを複数確認
③ 試せる修正を自分で試す
それでも解決できない場合のみ「試したこと」を添えて質問する。

**Y. 実装前にコードベースを先読み**
新機能を実装する前に `grep` / `glob` / ファイル読み込みで類似コンポーネント・関数・命名パターンを必ず検索する。
既存実装の再発明・スタイル不統一・命名の不整合を防ぐ。

---

## 💰 AI モデル選定（PP）

デフォルトは **DeepSeek V3（最優先）→ Gemini Flash 2.5（次点）** の順で採用。

| 用途 | モデル |
|------|--------|
| コーディング・JSON 出力・大量生成 | DeepSeek V3（Context Caching で実効 $0.014/1M = 90%OFF） |
| 画像・PDF・マルチモーダル | Gemini 1.5 Flash |
| 複雑な推論・長文生成・アーキテクチャ設計 | Claude Sonnet / Gemini Pro |

---

## 🚀 デプロイ安全規約（SAFE-DEPLOY）

**commit 前の必須チェック（この順番で実行）**:
1. `git status --short` — untracked ファイルゼロを確認（module-not-found の温床）
2. `npm install <pkg>` 経由で deps 追加（`package.json` 直接編集禁止）
3. TypeScript pre-check: `tsc --noEmit` でエラーゼロを確認
4. PowerShell で JSON/JS ファイルを編集した場合は BOM チェック: `head -c 3 <file> | xxd -p | grep -q efbbbf`

**deploy 完了の定義**:
- deploy webhook の HTTP 200 は「キュー成功」であって「build 成功」ではない
- 本番 URL で新コードの fingerprint を確認するまで完了とみなさない

**deploy 失敗時の即診断**:
- `module-not-found` → untracked ファイルの push 忘れ
- `EUSAGE: Missing from lock file` → `package.json` 手編集後に `npm install` 忘れ
- `ENOSPC` → `docker builder prune -af && docker image prune -af` を実行

---

## 📝 共通コーディング規約

1. コードは省略なし・完成形で提示する
2. UI テキストはプロジェクトの言語設定に従う（Paradigm 系プロジェクトは日本語統一）
3. コミットメッセージは `feat:` `fix:` `docs:` `refactor:` `chore:` プレフィックスで統一
4. 環境変数は `.env.example` として記録（実値は書かない）
5. 外部 URL は必ず新規タブで開く — `target="_blank" rel="noopener noreferrer"` 必須
6. `<img>` に `alt` 必須・インタラクティブ要素に `aria-label` 付与
7. TypeScript `any` 多用禁止（3 箇所以上で即リファクタ）
8. 1 ファイル 500 行超え禁止
9. エラーのサイレント握りつぶし禁止（`catch {}` は存在してはならない）
10. `alert()` / `confirm()` / `prompt()` 禁止 — Sonner toast / shadcn Dialog で代替
