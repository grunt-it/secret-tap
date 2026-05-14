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
4. On submit, the value is piped into
   `pass-cli item create login --vault-name <vault> --from-template -`.
5. Success → a little checkmark, the tab self-closes, the server stops and the
   process exits `0`.
6. Failure → the `pass-cli` error is shown in the page; the server stays up so
   you can fix and retry (re-login, change vault, etc.).

A 5-minute hard timeout means the tap never lingers.

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
