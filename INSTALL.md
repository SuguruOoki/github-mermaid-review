# Chrome に追加する

この ZIP はビルド済みです。Node.js やターミナルでの操作は必要ありません。

1. ZIP を展開して、`github-mermaid-review` フォルダを残しておきたい場所に移します。
2. Chrome のアドレスバーに `chrome://extensions` を入力します。
3. 右上の「デベロッパー モード」をオンにします。
4. 「パッケージ化されていない拡張機能を読み込む」を押し、**`manifest.json` が入っているフォルダ**を選びます。ZIP ファイル自体は選びません。
5. GitHub.com の PR で「Files changed」を開きます。すでに開いていたページは一度更新してください。

Markdown の見出しの下に「Mermaid プレビュー」が表示されます。図の開始・終了行が省略されている場合は、GitHub の省略行を展開してください。対応するコードファイルでは、画面右下に「副作用候補」が出ます。

GitHub のページを読み取る権限は、表示済みの差分を解析するために使います。コードを外部サービスへ送信したり保存したりする処理はありません。

読み込んだフォルダは移動・削除しないでください。更新するときは、新しい ZIP を同じ場所へ展開し、拡張機能画面の再読み込みボタンを押してから GitHub のページも更新します。不要になったら、拡張機能画面で無効化・削除できます。

詳しい使い方と GIF: https://github.com/SuguruOoki/github-mermaid-review

うまく動かない場合: https://github.com/SuguruOoki/github-mermaid-review/issues
