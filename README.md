# secret-tap

A localhost-only, single-use secret intake form. Run it, a browser tab opens,
you paste a secret, it lands in [Proton Pass](https://proton.me/pass) via
`pass-cli`. The value goes straight from the form POST into `pass-cli` over
stdin — never a CLI argument, never a file, never logged.

The point: hand a secret to Proton Pass without it passing through a terminal
you're sharing, a chat transcript, or shell history. Whoever started the
process (you, or an agent acting on your behalf) sees only the exit code.

Need more than one value? Add fields in the form — each typed **Secret**,
**Text**, **TOTP**, or **Timestamp** — and the item is stored with all of them
(e.g. an S3 `access-key-id` + `secret-access-key`, or a `username` + `password`
+ `endpoint`). Every value still rides in over stdin; none touch argv.

## Install

Straight from GitHub — no npm registry, no build step:

```sh
bun install -g "github:grunt-it/secret-tap#main"
```

Then run it:

```sh
secret-tap cloudflare-grunt-ai-gateway-runtime
# or pick the vault explicitly
secret-tap my-item-title --vault grunt
# preset the form's fields (names + types only — values are pasted in the browser)
secret-tap r2-token --vault grunt-ai \
  --field access-key-id:text --field secret-access-key:secret
```

`--field <name>[:<type>]` is repeatable and pre-fills the form's rows so you
only paste values. `<type>` is `secret` (default) · `text` · `totp` ·
`timestamp`. With no `--field`, the form opens with a single secret field
(stored as a login item).

Or run without installing:

```sh
bunx "github:grunt-it/secret-tap#main" my-item-title
```

To pick up updates, re-run the `bun install -g` line.

## What happens

1. A server starts on `127.0.0.1` on an OS-assigned random port.
2. The form lives behind an unguessable single-use path token — anything else
   gets a flat 404.
3. Your browser opens to it. Paste the value, optionally tweak the title. Add
   more fields if the credential has several parts; each field has a name, a
   type (Secret / Text / TOTP / Timestamp), and a value.
4. **Upsert step**: if an active item in `<vault>` already has the chosen
   title, it's first moved to trash (`pass-cli item trash --vault-name
   <vault> --item-title <title>` — title only, no secret in argv).
5. The value(s) are piped into `pass-cli item create … --from-template -`:
   - a single, untouched **Secret** field → a **login** item (`password`),
     so `pass://<vault>/<title>` still resolves it by default — identical to
     the original single-secret behaviour;
   - anything else (multiple fields, a renamed field, a non-secret type) → a
     **custom** item whose typed fields are each addressable as
     `pass://<vault>/<title>/<field-name>`.
   Either way the values ride in on stdin — never argv.
6. Success → a little checkmark (heading reads "Updated" if step 4 trashed
   one, "Stored" otherwise), the tab self-closes, the server stops and the
   process exits `0`.
7. Failure → the `pass-cli` error is shown in the page. If step 4 trashed an
   item, the tool tries to `untrash` it as rollback so the vault isn't left
   in a worse state. The server stays up so you can fix and retry (re-login,
   change vault, etc.).

A hard timeout means the tap never lingers — 5 minutes by default, or set
`--timeout <seconds>` (e.g. `--timeout 1800` for 30 minutes) when you need
longer to fetch the value.

The final stdout line is the machine-readable contract:
`secret-tap:result {"status":"stored","action":"stored"|"updated","title":"…","vault":"…","itemType":"login"|"custom","fields":["…"]}` —
callers (humans or agents) read `action` to know whether they created a new
item or rotated an existing one, and `fields` to know which names to reference
as `pass://<vault>/<title>/<field>`.

## Output contract

The exit code is the coarse signal (`0` stored, `1` timed out). The detail —
including the **final item title**, which you can edit in the form — is the
last line of stdout:

```
secret-tap:result {"status":"stored","action":"stored","title":"my-item","vault":"grunt","itemType":"login","fields":["password"]}
secret-tap:result {"status":"stored","action":"updated","title":"r2-token","vault":"grunt-ai","itemType":"custom","fields":["access-key-id","secret-access-key"]}
secret-tap:result {"status":"timeout"}
```

Parse that line (not the command-line argument) to learn what the item was
actually saved as — the **final title** (you can edit it in the form), the
**itemType**, and the **field names** for a custom item. It never contains a
secret value.

## Requirements

- [Bun](https://bun.sh) ≥ 1.0
- [`pass-cli`](https://proton.me/pass) installed and logged in (`pass-cli login`)

## Security notes

- Binds to `127.0.0.1` only — never `0.0.0.0`.
- The secret travels: browser → localhost POST body → process memory →
  `pass-cli` stdin. It is never written to stdout/stderr/disk by this tool.
- The one remote call is `pass-cli` → Proton Pass — that is where the secret is
  meant to land. There is no other network egress.
- Single submit, then the process exits. Re-run for the next secret.
