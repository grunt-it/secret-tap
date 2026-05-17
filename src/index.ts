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

/**
 * Returns the item-id of an *active* item in `vault` whose title matches
 * `title` exactly, or null if none exists. Trashed items don't count — we
 * only care about what's currently visible to readers.
 *
 * Used by the upsert path: if a same-title active item exists we trash it
 * before creating the replacement (see POST handler below).
 *
 * `pass-cli item list` output looks like:
 *   - [base64-id==]: <item title> (state=Active)
 *   - [base64-id==]: <other title> (state=Trashed)
 */
async function findActiveItemId(vault: string, title: string): Promise<string | null> {
  const list = Bun.spawn(["pass-cli", "item", "list", vault], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const ec = await list.exited;
  if (ec !== 0) {
    // Can't list — bubble null and let the caller decide. The POST handler
    // catches and falls through to create; the create will then surface the
    // real error (e.g. auth) cleanly.
    throw new Error(`pass-cli item list exited with code ${ec}`);
  }
  const out = await new Response(list.stdout).text();
  for (const line of out.split("\n")) {
    const m = line.match(/^-\s+\[([^\]]+)\]:\s*(.+?)\s+\(state=(\w+)\)\s*$/);
    if (m && m[3] === "Active" && m[2] === title) return m[1] ?? null;
  }
  return null;
}

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

      // If an active item with this title already exists in the vault, move
      // it to trash before creating the replacement. This makes secret-tap
      // act as an upsert — rotating a token just requires re-running with
      // the same item title. The trash step takes only the title in argv
      // (no secret value), so it preserves the "secret never enters argv"
      // property of the create flow. If the new-item create then fails, we
      // untrash the original to leave the vault as we found it.
      let trashedExisting = false;
      try {
        const existingId = await findActiveItemId(vault, title);
        if (existingId !== null) {
          const trash = Bun.spawn(
            ["pass-cli", "item", "trash", "--vault-name", vault, "--item-title", title],
            { stdout: "pipe", stderr: "pipe" },
          );
          const tec = await trash.exited;
          if (tec !== 0) {
            const tstderr = (await new Response(trash.stderr).text()).trim();
            return html(
              renderError(
                `Couldn't trash existing "${title}" in vault "${vault}" before update: ${tstderr || `pass-cli exited ${tec}`}`,
              ),
              500,
            );
          }
          trashedExisting = true;
        }
      } catch (e) {
        // If we can't list (e.g. session issue), let the create below run
        // and surface the real error from there.
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
        // Rollback: if we trashed the existing item, try to bring it back so
        // the vault isn't left in a worse state than we found it. Best-effort
        // — surface a hint if the rollback also fails.
        let rollbackHint = "";
        if (trashedExisting) {
          const untrash = Bun.spawn(
            ["pass-cli", "item", "untrash", "--vault-name", vault, "--item-title", title],
            { stdout: "pipe", stderr: "pipe" },
          );
          const uec = await untrash.exited;
          if (uec !== 0) {
            rollbackHint = ` (rollback also failed: original "${title}" is still in trash — restore it via Proton Pass)`;
          }
        }
        return html(renderError(detail + rollbackHint), 500);
      }

      const action: "stored" | "updated" = trashedExisting ? "updated" : "stored";
      used = true;
      // Flush the success page, then shut down.
      queueMicrotask(() => {
        setTimeout(() => {
          server.stop(true);
          const verb = action === "updated" ? "Updated" : "Stored";
          console.log(`  ${verb} "${title}" in vault "${vault}".`);
          // Stable machine-readable contract: on success the FINAL stdout
          // line is always `secret-tap:result <json>`. The caller (a human,
          // or an agent that invoked the tool) reads the final item title
          // and vault from here — the user may have edited the title in the
          // form, so the title passed on the command line is not authoritative.
          // `action` is "stored" for a fresh item, "updated" if an existing
          // active item with the same title was rotated.
          emitResult({ status: "stored", action, title, vault });
          process.exit(0);
        }, 600);
      });
      return html(renderSuccess(title, vault, action));
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

/**
 * The tool's machine-readable contract. The LAST line of stdout is always
 * `secret-tap:result <json>`:
 *   - `{ status: "stored", action: "stored" | "updated", title, vault }` on success
 *   - `{ status: "timeout" }` if the tap timed out
 *
 * The exit code (0 / 1) is the coarse signal; this line carries the detail a
 * caller needs to act — above all the FINAL title, since the user can rename
 * in the form, and `action` so the caller knows whether they created a new
 * item or rotated an existing one. Never contains the secret value.
 */
function emitResult(result: {
  status: "stored" | "timeout";
  action?: "stored" | "updated";
  title?: string;
  vault?: string;
}): void {
  console.log(`secret-tap:result ${JSON.stringify(result)}`);
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
  emitResult({ status: "timeout" });
  server.stop(true);
  process.exit(1);
}, TIMEOUT_MS);
