#!/usr/bin/env bun
/**
 * secret-tap — a localhost-only, single-use secret intake form.
 *
 * Run it, a browser tab opens with a form. Paste a secret, submit. The value
 * goes straight from the form POST into `pass-cli item create` (Proton Pass)
 * via stdin — never a CLI arg, never a file, never logged. Whoever started
 * the process (a human, an agent) sees only the exit code.
 *
 * Hardening:
 *   - server binds to 127.0.0.1 only, on an OS-assigned random port
 *   - the form lives behind an unguessable single-use path token
 *   - one successful submit and the server stops + exits
 *   - 5-minute hard timeout so it never lingers
 *   - the secret value is never written to stdout, stderr, or disk
 */
import { renderPage, renderSuccess, renderError } from "./page.ts";

const TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_VAULT = "grunt";

function parseArgs(argv: string[]): { title: string; vault: string } {
  let vault = DEFAULT_VAULT;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--vault" || a === "-v") {
      const next = argv[++i];
      if (next) vault = next;
    } else if (a === "--help" || a === "-h") {
      console.log(
        "secret-tap — paste a secret into a local browser form, it lands in Proton Pass.\n\n" +
          "Usage: secret-tap [item-title] [--vault <name>]\n\n" +
          `  item-title   pre-fills the title field (default vault: ${DEFAULT_VAULT})\n` +
          "  --vault, -v  Proton Pass vault to store into\n",
      );
      process.exit(0);
    } else {
      rest.push(a);
    }
  }
  return { title: rest.join(" "), vault };
}

const { title: initialTitle, vault } = parseArgs(process.argv.slice(2));

// Unguessable single-use path — only the tab we open knows it. Anything
// hitting any other path gets a flat 404.
const pathToken = (crypto.randomUUID() + crypto.randomUUID()).replaceAll("-", "");

let used = false;

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  // Generous: the human is reading + pasting. The 5-min process timeout is
  // the real bound; this just stops a hung socket wedging things.
  idleTimeout: 60,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname !== `/${pathToken}`) {
      return new Response("Not found", { status: 404 });
    }

    if (req.method === "GET") {
      return html(renderPage(initialTitle, vault));
    }

    if (req.method === "POST") {
      if (used) {
        return html(renderError("This tap was already used. Start a fresh one."), 409);
      }

      const form = await req.formData();
      const title = String(form.get("title") ?? "").trim();
      const value = String(form.get("value") ?? "");
      if (!title || !value) {
        return html(renderError("Title and value are both required."), 400);
      }

      // Proton Pass login-item template (see `pass-cli item create login
      // --get-template`). The secret rides in on stdin — never argv.
      const template = JSON.stringify({
        title,
        username: null,
        email: null,
        password: value,
        totp_uri: null,
        urls: [],
      });

      const proc = Bun.spawn(
        ["pass-cli", "item", "create", "login", "--vault-name", vault, "--from-template", "-"],
        {
          stdin: new TextEncoder().encode(template),
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const exitCode = await proc.exited;

      if (exitCode !== 0) {
        const stderr = (await new Response(proc.stderr).text()).trim();
        const detail = stderr || `pass-cli exited with code ${exitCode}`;
        // Surface the failure to the browser; keep the server alive so the
        // user can fix + retry (e.g. re-login, change vault).
        return html(renderError(detail), 500);
      }

      used = true;
      // Flush the success page, then shut down.
      queueMicrotask(() => {
        setTimeout(() => {
          server.stop(true);
          console.log(`  Stored "${title}" in vault "${vault}".`);
          process.exit(0);
        }, 600);
      });
      return html(renderSuccess(title, vault));
    }

    return new Response("Method not allowed", { status: 405 });
  },
});

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    },
  });
}

const tapUrl = `http://127.0.0.1:${server.port}/${pathToken}`;
console.log("");
console.log(`  secret-tap → Proton Pass vault "${vault}"`);
console.log(`  ${tapUrl}`);
console.log("");

// Open the default browser (macOS `open`; Linux `xdg-open`). On failure,
// the printed URL above is the fallback.
const opener = process.platform === "darwin" ? "open" : "xdg-open";
try {
  Bun.spawn([opener, tapUrl], { stdout: "ignore", stderr: "ignore" });
} catch {
  console.log("  (couldn't auto-open a browser — open the URL above yourself)");
}

// Never leave the tap listening forever.
setTimeout(() => {
  console.error("  Timed out — no secret submitted in 5 minutes. Exiting.");
  server.stop(true);
  process.exit(1);
}, TIMEOUT_MS);
