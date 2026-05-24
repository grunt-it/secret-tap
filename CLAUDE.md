# CLAUDE.md

`secret-tap` — a localhost-only, single-use secret intake form. Paste a secret
into a local browser tab, it lands in Proton Pass via `pass-cli`. Nothing else
sees the value.

## Shape

Tiny on purpose. Two source files, no dependencies beyond Bun + `pass-cli`.

```
src/index.ts   — CLI arg parse, Bun.serve on 127.0.0.1:0, POST → pass-cli, shutdown
src/page.ts    — inline HTML/CSS/JS for the form + success + error states
```

Do not add a framework, a build step, or an asset pipeline. If it needs more
than two files it has outgrown its purpose — stop and reconsider.

## Hard rules

- **The secret value never touches argv, a file, stdout, or stderr.** It rides
  from the form POST body into `pass-cli` stdin via `--from-template -`. Any
  change that risks the value landing in a log, a process arg, or disk is a
  bug, not a feature.
- **Bind `127.0.0.1` only.** Never `0.0.0.0`, never a configurable host.
- **Single-use.** One successful submit → server stops → process exits. The
  unguessable path token is the access guard; keep it.
- **No telemetry, no analytics, no remote calls** except `pass-cli` → Proton
  Pass. That one is the whole point; nothing else gets to phone home.

## Conventions

- Bun, not node/npm. `bun install`, `bun run`.
- `bun run typecheck` before publishing.
- The store path is `pass-cli item create <type> --vault-name <vault>
  --from-template -` (template + values on stdin — never in argv), where
  `<type>` is decided from the submitted fields:
  - **login** when there's exactly one untouched Secret field named
    `password` (or unnamed). Preserves the original single-secret behaviour
    and the `pass://<vault>/<title>` default-field convention. Template
    matches `pass-cli item create login --get-template`.
  - **custom** for everything else (multiple fields, a renamed field, a
    non-secret type). Each field becomes a typed section field
    (`field_type` ∈ `text` | `hidden` | `totp` | `timestamp`), addressable
    as `pass://<vault>/<title>/<field-name>`. Template matches
    `pass-cli item create custom --get-template`.
  If `pass-cli` changes either template schema, update the JSON in `index.ts`
  to match the corresponding `--get-template`.
- The form posts one parallel `fname` / `ftype` / `fvalue` triple per field
  row; `index.ts` zips them by index (FormData preserves DOM order). Field
  NAMES and TYPES are not secret and ride in the template too — only the
  trash step's `--item-title` is ever in argv, and the title isn't secret.
- The tool acts as an UPSERT: before create, an active same-title item is
  moved to trash via `pass-cli item trash --vault-name <vault> --item-title
  <title>` (title only — preserves the "no secret in argv" property). On
  create failure, rollback via `pass-cli item untrash` of the trashed item.
  Trashed items can also be manually restored from Proton Pass if the
  rollback itself fails. Update-via-`pass-cli item update --field
  password=<value>` is **not** used because `--field` puts the value in
  argv, defeating the whole point.

## Distribution

Installed straight from GitHub — `bun install -g "github:grunt-it/secret-tap#main"`.
No npm publish, no build step (Bun runs the `.ts` bin directly). Bun needs the
explicit `#main` ref; a bare `github:grunt-it/secret-tap` 404s.

To cut a versioned release later: bump `version` in `package.json`, tag, and
either point installs at the tag or `bun publish`. Not needed for now.
