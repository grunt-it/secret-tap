#!/usr/bin/env bun
/**
 * secret-tap — a localhost-only, single-use secret intake form.
 *
 * Run it, a browser tab opens with a form. Paste a secret (or add several
 * typed fields — Secret / Text / TOTP / Timestamp), submit. The value(s) go
 * straight from the form POST into `pass-cli item create` (Proton Pass) via
 * stdin — never a CLI arg, never a file, never logged. One default secret is
 * stored as a login item; multiple/typed fields become a custom item. Whoever
 * started the process (a human, an agent) sees only the exit code + result.
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

/** A field row pre-populated in the form from a `--field` flag. Name + type
 * only — never a value (values are entered in the browser, never on argv). */
interface PresetField {
  name: string;
  /** internal pass-cli field_type: hidden | text | totp | timestamp */
  type: string;
}

/** Friendly CLI type names → pass-cli `field_type`. "secret" is the friendly
 * spelling of "hidden"; both accepted. */
const FIELD_TYPE_ALIASES: Record<string, string> = {
  secret: "hidden",
  hidden: "hidden",
  text: "text",
  totp: "totp",
  timestamp: "timestamp",
};

function parseArgs(argv: string[]): {
  title: string;
  vault: string;
  noOpen: boolean;
  fields: PresetField[];
  timeoutMs: number;
} {
  let vault = DEFAULT_VAULT;
  let noOpen = false;
  let timeoutMs = TIMEOUT_MS;
  const fields: PresetField[] = [];
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--vault" || a === "-v") {
      const next = argv[++i];
      if (next) vault = next;
    } else if (a === "--field" || a === "-f") {
      // --field <name>[:<type>] — presets one form row. Repeatable. No value
      // here; values are pasted into the browser form. (name/type aren't
      // secret, so being on argv is fine.)
      const next = argv[++i];
      if (!next) {
        console.error("  --field needs a value: --field <name>[:<type>]");
        process.exit(2);
      }
      const colon = next.indexOf(":");
      const name = (colon === -1 ? next : next.slice(0, colon)).trim();
      const rawType = (colon === -1 ? "secret" : next.slice(colon + 1)).trim().toLowerCase();
      if (!name) {
        console.error(`  --field needs a name before the colon: "${next}"`);
        process.exit(2);
      }
      const type = FIELD_TYPE_ALIASES[rawType];
      if (!type) {
        console.error(
          `  --field "${next}": unknown type "${rawType}". Use secret | text | totp | timestamp.`,
        );
        process.exit(2);
      }
      fields.push({ name, type });
    } else if (a === "--timeout") {
      const next = argv[++i];
      const secs = next ? Number.parseInt(next, 10) : Number.NaN;
      if (!Number.isFinite(secs) || secs <= 0) {
        console.error("  --timeout needs a positive number of seconds, e.g. --timeout 1800");
        process.exit(2);
      }
      timeoutMs = secs * 1000;
    } else if (a === "--no-open") {
      noOpen = true;
    } else if (a === "--help" || a === "-h") {
      console.log(
        "secret-tap — paste a secret (or several typed fields) into a local browser\n" +
          "form; it lands in Proton Pass. Value(s) never touch argv, a file, or a log.\n\n" +
          "Usage: secret-tap [item-title] [--vault <name>] [--field <name>[:<type>]]… [--no-open]\n\n" +
          `  item-title       pre-fills the title field (default vault: ${DEFAULT_VAULT})\n` +
          "  --vault, -v      Proton Pass vault to store into\n" +
          "  --field, -f      preset a form row: <name>[:<type>], repeatable.\n" +
          "                   <type> = secret (default) | text | totp | timestamp.\n" +
          "  --no-open        don't auto-open a browser; just print the URL\n" +
          "  --timeout <secs> how long the form stays open before giving up (default 300)\n\n" +
          "One secret by default → stored as a login item's password. Preset (or add\n" +
          "in the form) several typed fields and it's stored as a custom item, every\n" +
          "field addressable as pass://<vault>/<title>/<field-name>.\n\n" +
          "  e.g.  secret-tap r2-token --vault grunt-ai \\\n" +
          "          --field access-key-id:text --field secret-access-key:secret\n",
      );
      process.exit(0);
    } else {
      rest.push(a);
    }
  }
  return { title: rest.join(" "), vault, noOpen, fields, timeoutMs };
}

const {
  title: initialTitle,
  vault,
  noOpen,
  fields: presetFields,
  timeoutMs,
} = parseArgs(process.argv.slice(2));

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
      return html(renderPage(initialTitle, vault, presetFields));
    }

    if (req.method === "POST") {
      if (used) {
        return html(renderError("This tap was already used. Start a fresh one."), 409);
      }

      const form = await req.formData();
      const title = String(form.get("title") ?? "").trim();

      // Each field row in the form posts one parallel entry into fname / ftype
      // / fvalue. FormData preserves DOM order, so they zip back together by
      // index. Drop fully-empty rows (a field that was added but never filled).
      const rawNames = form.getAll("fname").map((v) => String(v));
      const rawTypes = form.getAll("ftype").map((v) => String(v));
      const rawValues = form.getAll("fvalue").map((v) => String(v));
      const ALLOWED_TYPES = new Set(["hidden", "text", "totp", "timestamp"]);
      const rowCount = Math.max(rawNames.length, rawTypes.length, rawValues.length);
      const fields: { name: string; type: string; value: string }[] = [];
      for (let i = 0; i < rowCount; i++) {
        const name = (rawNames[i] ?? "").trim();
        const type = (rawTypes[i] ?? "text").trim();
        const value = rawValues[i] ?? "";
        if (name === "" && value === "") continue;
        fields.push({ name, type, value });
      }

      if (!title) return html(renderError("Item title is required."), 400);
      if (fields.length === 0) {
        return html(renderError("Add at least one field with a value."), 400);
      }
      for (const f of fields) {
        if (!ALLOWED_TYPES.has(f.type)) {
          return html(renderError(`Unknown field type "${f.type}".`), 400);
        }
      }

      // One untouched secret field → a plain login item (password), preserving
      // the original single-secret behaviour and the `pass://<vault>/<title>`
      // default-field convention. Anything else (multiple fields, a renamed
      // field, or a non-secret type) → a custom item whose typed fields are
      // each addressable as pass://<vault>/<title>/<field-name>. Either way the
      // value(s) ride into pass-cli on stdin via the template — never argv.
      const only = fields.length === 1 ? fields[0]! : null;
      const isLoginDefault =
        only !== null &&
        only.type === "hidden" &&
        (only.name === "" || only.name === "password");

      let itemType: "login" | "custom";
      let template: string;
      let fieldNames: string[];

      if (isLoginDefault) {
        if (only!.value === "") {
          return html(renderError("The secret value is required."), 400);
        }
        itemType = "login";
        fieldNames = ["password"];
        template = JSON.stringify({
          title,
          username: null,
          email: null,
          password: only!.value,
          totp_uri: null,
          urls: [],
        });
      } else {
        for (const f of fields) {
          if (f.name === "" || f.value === "") {
            return html(renderError("Every field needs a name and a value."), 400);
          }
        }
        itemType = "custom";
        fieldNames = fields.map((f) => f.name);
        template = JSON.stringify({
          title,
          note: "",
          sections: [
            {
              section_name: "secret-tap",
              fields: fields.map((f) => ({
                field_name: f.name,
                field_type: f.type,
                value: f.value,
              })),
            },
          ],
        });
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

      // The secret(s) ride in on stdin via the template prepared above — never
      // argv. `itemType` is "login" (one default secret) or "custom" (typed
      // fields); both are valid `pass-cli item create` subcommands and both
      // accept the same `--from-template -` stdin contract.
      const proc = Bun.spawn(
        ["pass-cli", "item", "create", itemType, "--vault-name", vault, "--from-template", "-"],
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
          emitResult({ status: "stored", action, title, vault, itemType, fields: fieldNames });
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
 *   - on success: `{ status: "stored", action: "stored" | "updated", title,
 *     vault, itemType: "login" | "custom", fields: [<field-name>, ...] }`
 *   - on timeout:  `{ status: "timeout" }`
 *
 * The exit code (0 / 1) is the coarse signal; this line carries the detail a
 * caller needs to act — the FINAL title (the user can rename in the form),
 * `action` (created vs rotated), and for custom items the `fields` names so a
 * caller knows what to reference as pass://<vault>/<title>/<field>. Never
 * contains a secret value.
 */
function emitResult(result: {
  status: "stored" | "timeout";
  action?: "stored" | "updated";
  title?: string;
  vault?: string;
  itemType?: "login" | "custom";
  fields?: string[];
}): void {
  console.log(`secret-tap:result ${JSON.stringify(result)}`);
}

const tapUrl = `http://127.0.0.1:${server.port}/${pathToken}`;
console.log("");
console.log(`  secret-tap → Proton Pass vault "${vault}"`);
console.log(`  ${tapUrl}`);
console.log("");

// Open the default browser (macOS `open`; Linux `xdg-open`). On failure — or
// with --no-open — the printed URL above is the fallback.
if (noOpen) {
  console.log("  (--no-open: open the URL above in a browser yourself)");
} else {
  const opener = process.platform === "darwin" ? "open" : "xdg-open";
  try {
    Bun.spawn([opener, tapUrl], { stdout: "ignore", stderr: "ignore" });
  } catch {
    console.log("  (couldn't auto-open a browser — open the URL above yourself)");
  }
}

// Never leave the tap listening forever (default 5 min; --timeout overrides).
setTimeout(() => {
  const mins = Math.round(timeoutMs / 60000);
  console.error(
    `  Timed out — no secret submitted in ${mins} minute${mins === 1 ? "" : "s"}. Exiting.`,
  );
  emitResult({ status: "timeout" });
  server.stop(true);
  process.exit(1);
}, timeoutMs);
