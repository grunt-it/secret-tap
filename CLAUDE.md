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
- `--field <name>[:<type>]` (repeatable) presets the form's rows: names +
  types only, **never a value** (values are pasted in the browser, so they
  stay off argv). The presets are serialised into the page as `PRESET_FIELDS`
  and `page.ts` builds the initial rows from them; with none, it falls back to
  the single `password`/Secret row. CLI type spellings (`secret` → `hidden`,
  `text`, `totp`, `timestamp`) map via `FIELD_TYPE_ALIASES` in `index.ts`.
- The tool acts as a **collision-safe UPSERT**. Before create, an active
  same-title item is **renamed** to a unique superseded title
  (`<title> (replaced <iso-ts>)`) via `pass-cli item update --item-id <id>
  --field title=<superseded>` and *then* trashed under that new title. The
  rename is the load-bearing part: trashing under the *same* title leaves a
  same-title trashed item, and pass-cli's `pass://` resolution can match that
  stale trashed item instead of the new one — silently returning old values
  (hit live 2026-05-24 rotating `r2-token`). Renaming first means the new item
  owns the title alone and resolves cleanly. On create failure: untrash +
  rename the original back to `<title>`. Only the (non-secret) title is ever
  in argv across rename/trash/untrash, preserving the "no secret in argv"
  property. Update-via-`pass-cli item update --field password=<value>` is still
  **not** used for the value because `--field` would put the secret in argv.

## Distribution

Installed straight from GitHub — `bun install -g "github:grunt-it/secret-tap#main"`.
No npm publish, no build step (Bun runs the `.ts` bin directly). Bun needs the
explicit `#main` ref; a bare `github:grunt-it/secret-tap` 404s.

To cut a versioned release later: bump `version` in `package.json`, tag, and
either point installs at the tag or `bun publish`. Not needed for now.

**bun `#main` cache gotcha (real, repeatedly hit):** after pushing a new
commit to `main`, `bun install -g "github:grunt-it/secret-tap#main"` — even
with `--force` — keeps resolving the *stale* cached `main` ref to the previous
commit, so the global stays on the old version. bun's git ref cache isn't
re-fetched by a plain reinstall. Reliable fix: remove + clear the cache + pin
to the new commit SHA:

```sh
bun remove -g @grunt-it/secret-tap
rm -rf ~/.bun/install/cache/@GH@grunt-it-secret-tap-* ~/.bun/install/cache/@grunt-it
bun install -g "github:grunt-it/secret-tap#<new-sha>"   # e.g. #113bb0f
```

Verify with `grep '"version"' ~/.bun/install/global/node_modules/@grunt-it/secret-tap/package.json`.
Testing locally needs none of this — just run `bun src/index.ts …` against the
working tree.
