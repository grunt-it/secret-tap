# secret-tap

A localhost-only, single-use secret intake form. Run it, a browser tab opens,
you paste a secret, it lands in [Proton Pass](https://proton.me/pass) via
`pass-cli`. The value goes straight from the form POST into `pass-cli` over
stdin — never a CLI argument, never a file, never logged.

The point: hand a secret to Proton Pass without it passing through a terminal
you're sharing, a chat transcript, or shell history. Whoever started the
process (you, or an agent acting on your behalf) sees only the exit code.

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
```

Or run without installing:

```sh
bunx "github:grunt-it/secret-tap#main" my-item-title
```

To pick up updates, re-run the `bun install -g` line.

## What happens

1. A server starts on `127.0.0.1` on an OS-assigned random port.
2. The form lives behind an unguessable single-use path token — anything else
   gets a flat 404.
3. Your browser opens to it. Paste the value, optionally tweak the title.
4. **Upsert step**: if an active item in `<vault>` already has the chosen
   title, it's first moved to trash (`pass-cli item trash --vault-name
   <vault> --item-title <title>` — title only, no secret in argv).
5. The value is piped into
   `pass-cli item create login --vault-name <vault> --from-template -`.
   Whether the previous item was trashed in step 4 or not, the new value
   always rides in on stdin — never argv.
6. Success → a little checkmark (heading reads "Updated" if step 4 trashed
   one, "Stored" otherwise), the tab self-closes, the server stops and the
   process exits `0`.
7. Failure → the `pass-cli` error is shown in the page. If step 4 trashed an
   item, the tool tries to `untrash` it as rollback so the vault isn't left
   in a worse state. The server stays up so you can fix and retry (re-login,
   change vault, etc.).

A 5-minute hard timeout means the tap never lingers.

The final stdout line is the machine-readable contract:
`secret-tap:result {"status":"stored","action":"stored"|"updated","title":"…","vault":"…"}` —
callers (humans or agents) read `action` to know whether they created a new
item or rotated an existing one.

## Output contract

The exit code is the coarse signal (`0` stored, `1` timed out). The detail —
including the **final item title**, which you can edit in the form — is the
last line of stdout:

```
secret-tap:result {"status":"stored","title":"my-item","vault":"grunt"}
secret-tap:result {"status":"timeout"}
```

Parse that line (not the command-line argument) to learn what the item was
actually saved as. It never contains the secret value.

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
