# LaTeX project maintenance

LaTeX import converts supported constructs to Typst and keeps the original `.tex` files. ZIP export contains the entire project and a manifest with its selected main file. Reimporting that ZIP restores the project without converting those originals again. ZIP export does not translate edited Typst back into LaTeX.

## Reproduce the browser checks

```sh
bun install --frozen-lockfile
bun run test
bun run lint
bun run build:budget
bun run test:helium
```

`test:helium` launches the installed macOS Helium application with an isolated browser profile. It builds the production app and serves it on `127.0.0.1:5179`. It does not use the user's open tabs or project database. For another installation, run `HELIUM_PATH=/path/to/Helium bun run test:e2e --headed`. Without `HELIUM_PATH`, Playwright uses its installed Chromium.

The browser scenarios in `e2e/project-import-export.spec.ts` generate their own ZIP fixtures and use the visible import/export controls. They cover:

| Scenario | Checks |
| --- | --- |
| Multi-file article | Nested inputs, tables, math, image, citation, `.bib`, preview, actual PDF download |
| Converted ZIP roundtrip | All exported paths and bytes survive reimport, including original LaTeX and binary assets |
| Biblatex | Resource declaration, bibliography, title/date, math heading, numbered equation reference |
| Native project | Selected entrypoint and raw `.tex` survive export without another conversion |
| Corrupt ZIP | Visible import error, then successful import without reloading the app |
| Manual bibliography | Citation in another file, extensionless image, document-root selection |
| Sidebar upload | Existing source remains intact, renamed upload and bibliography survive reload |
| Bulk backup | Projects with the same name keep distinct folders, contents, and restored names |

Playwright writes failure screenshots, traces, and an HTML report to ignored directories. Successful document screenshots are saved under `test-results`.

## Regression coverage

Unit tests additionally cover normalized path collisions, traversal rejection, file/folder conflicts, source preservation, text encodings, explicit empty projects, manifests, bulk exports, project naming, storage failures, and recovery of unsaved edits. Converter tests exercise math, bibliography commands, rich text, figures, lists, tables, and escaped characters.

## Limits

This is a LaTeX-to-Typst converter, not a TeX engine. Arbitrary document classes, package behavior, custom macros, TikZ, and executable TeX cannot be reproduced in full. Conversion warnings identify constructs that need attention, and the original sources remain available. A rendered preview and successful PDF compilation establish that a fixture compiles, not that every LaTeX layout is identical.
