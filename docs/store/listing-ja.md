# Chrome Web Store 掲載情報

## 名前

GitHub Mermaid Review

## 概要

GitHub の PR 差分で Mermaid の変更前後をプレビューし、副作用候補のある変更行を強調します。

## 説明

GitHub の「Files changed」で、Mermaid を図として確認できる Chrome 拡張です。変更前と変更後を並べて表示し、コード差分では副作用の候補がある行からレビューを始められます！

Mermaid のコードフェンスがある Markdown ファイルを開くと、ファイル見出しの下にプレビューが出ます。図は拡大・縮小でき、読み取ったソースも確認できます。開始行や終了行が省略されているときは、GitHub の省略行を展開してください。

JavaScript・TypeScript・PHP・Python の変更行では、DB・ファイルへの書き込み、外部通信、状態変更などの候補にオレンジの線を付けます。右下の一覧でファイル名、行番号、一致した構文を確認し、クリックすると該当行へ移動できます。追加行・削除行の両方が対象です。

候補の抽出には既知の呼び出し名や代入を使っています。実際の副作用や危険性を断定するものではありません。独自のラッパーや複数行の呼び出しなどは見逃す場合があり、同名の別処理が候補になる場合もあります。

表示済みのコード、ファイル名、行番号、現在の GitHub URL をブラウザ内で処理します。コードや図の外部送信・保存、アクセス解析は行いません。図の描画ライブラリも同梱しています。

GitHub.com の PR 差分画面で利用できます。Unified / Split、新旧の差分表示に対応しています。Mermaid は .md・.markdown・.mdx 内の完全なコードフェンスが対象です。GitHub Enterprise の独自ドメイン、単独の .mmd ファイル、リッチ差分には対応していません。

使い方・操作 GIF:
https://github.com/SuguruOoki/github-mermaid-review

プライバシーポリシー:
https://github.com/SuguruOoki/github-mermaid-review/blob/main/PRIVACY.md

本拡張は GitHub および Google の公式製品ではありません。

## 単一用途

GitHub の PR 差分のレビューを支援します。差分中の Mermaid を図で比較し、副作用候補のある変更行を強調して、確認する行へ移動しやすくします。

## GitHub のサイトアクセス権限の理由

GitHub の表示済みの PR 差分を読み取り、Mermaid プレビューと副作用候補を同じ画面に表示するために必要です。GitHub 内のページ移動ではページ全体が再読み込みされないため、github.com 全体でスクリプトを読み込み、PR 差分の URL でのみ解析・表示します。GitHub API や他のサイトにはアクセスしません。

## リモートコード

使用しません。JavaScript と Mermaid はすべて拡張の ZIP に含まれます。実行時に外部の JavaScript を取得する処理はありません。

## データの申告

Web サイトのコンテンツ（表示済みの差分コード、ファイル名、行番号）と、現在開いている GitHub URL をローカルで扱います。外部送信・永続保存・販売・広告利用はありません。現在の URL を参照するため、ダッシュボードでは Web サイトのコンテンツとウェブ履歴に相当する項目を開示します。ブラウザ全体の履歴を取得する機能はありません。

## 掲載設定

言語: 日本語

用途: 開発者向けツール

価格: 無料

公開範囲: 一般公開

ホームページ: https://github.com/SuguruOoki/github-mermaid-review

サポート: https://github.com/SuguruOoki/github-mermaid-review/issues

プライバシーポリシー: https://github.com/SuguruOoki/github-mermaid-review/blob/main/PRIVACY.md
