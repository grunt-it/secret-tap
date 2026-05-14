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
- The `pass-cli` invocation shape is pinned to
  `pass-cli item create login --from-template -`. If `pass-cli` changes its
  template schema, update the JSON in `index.ts` to match
  `pass-cli item create login --get-template`.

## Distribution

Installed straight from GitHub — `bun install -g "github:grunt-it/secret-tap#main"`.
No npm publish, no build step (Bun runs the `.ts` bin directly). Bun needs the
explicit `#main` ref; a bare `github:grunt-it/secret-tap` 404s.

To cut a versioned release later: bump `version` in `package.json`, tag, and
either point installs at the tag or `bun publish`. Not needed for now.
