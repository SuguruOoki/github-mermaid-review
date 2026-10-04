# Review instructions

The extension runs on GitHub.com pull-request diff pages (`/files` or `/changes`). There is no extension account, API key, subscription, or backend. Public pull requests can be used without access to private repositories.

1. Open https://github.com/mermaid-js/mermaid/pull/8198/files and locate `docs/syntax/sequenceDiagram.md`. Open the file diff and expand surrounding lines if a Mermaid fence is incomplete. The `Mermaid プレビュー` panel renders complete Mermaid blocks separately for before and after. Source and zoom controls are inside each diagram.
2. Open https://github.com/nodejs/node/pull/50990/files and locate `test/parallel/test-fs-write-file-sync.js`. The added `fs.writeFileSync(...)` at line 113 is outlined in orange. Open the bottom-right `副作用候補` panel and click the candidate to navigate to its source line.
3. The candidate feature is heuristic. It does not prove a function has side effects or that a change is unsafe. Source diff colors and code remain intact. Both added and removed lines are checked.
4. The extension reads currently displayed diff content, file names, line numbers and the current GitHub URL locally. It does not send source code, diagrams, URLs or analytics to a server, or save them to persistent storage. It does not use cookies, history APIs or the GitHub API. The broad GitHub content-script match supports client-side navigation; analysis and UI are restricted to pull-request diff routes.
5. All executable code, including Mermaid, is packaged locally. Diagram rendering is sandboxed and external connections from that sandbox are blocked by CSP. No remotely hosted code is used.

Source and build instructions: https://github.com/SuguruOoki/github-mermaid-review
Privacy policy: https://github.com/SuguruOoki/github-mermaid-review/blob/main/PRIVACY.md

Store screenshots use synthetic sample diffs and the actual extension in an isolated Chromium profile. They do not show private repositories or user accounts.
