/**
 * HTML for the secret-tap localhost form. Everything is inline — no asset
 * pipeline for a single-purpose tool. The secret value never leaves the
 * page except as the POST body to the same localhost origin.
 */

const escapeHtml = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c] ?? c,
  );

const SHELL = (inner: string): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>secret-tap</title>
<style>
  :root {
    --ink: #1c1b22;
    --muted: #6b6878;
    --line: #e7e4ef;
    --accent: #6d5ef0;
    --accent-soft: #efedfd;
    --ok: #18b26b;
    --err: #e5484d;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif;
    color: var(--ink);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: linear-gradient(-45deg, #ece9ff, #f3eefe, #e6f7ff, #fdeef8);
    background-size: 400% 400%;
    animation: drift 18s ease infinite;
  }
  @keyframes drift {
    0% { background-position: 0% 50%; }
    50% { background-position: 100% 50%; }
    100% { background-position: 0% 50%; }
  }
  .card {
    width: 100%;
    max-width: 460px;
    background: rgba(255, 255, 255, 0.86);
    backdrop-filter: blur(14px);
    border: 1px solid rgba(255, 255, 255, 0.6);
    border-radius: 20px;
    box-shadow: 0 18px 50px -12px rgba(60, 50, 120, 0.28);
    padding: 30px 30px 26px;
    animation: rise 0.5s cubic-bezier(0.18, 0.9, 0.3, 1.2);
  }
  @keyframes rise {
    from { opacity: 0; transform: translateY(14px) scale(0.98); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--accent);
    background: var(--accent-soft);
    padding: 5px 10px;
    border-radius: 999px;
  }
  .dot {
    width: 6px; height: 6px; border-radius: 50%;
    background: var(--accent);
    animation: pulse 1.6s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.4; transform: scale(0.7); }
  }
  h1 { font-size: 21px; margin: 14px 0 4px; letter-spacing: -0.01em; }
  .sub { font-size: 13.5px; color: var(--muted); line-height: 1.5; margin-bottom: 20px; }
  label { display: block; font-size: 12.5px; font-weight: 600; margin: 0 0 6px; }
  .field { margin-bottom: 16px; }
  input[type="text"], textarea {
    width: 100%;
    font: inherit;
    font-size: 14px;
    color: var(--ink);
    background: #fff;
    border: 1.5px solid var(--line);
    border-radius: 12px;
    padding: 11px 13px;
    transition: border-color 0.18s ease, box-shadow 0.18s ease;
    outline: none;
  }
  textarea {
    font-family: "SF Mono", "JetBrains Mono", ui-monospace, monospace;
    font-size: 13px;
    resize: vertical;
    min-height: 88px;
    line-height: 1.45;
  }
  input[type="text"]:focus, textarea:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 4px var(--accent-soft);
  }
  textarea.masked { -webkit-text-security: disc; text-security: disc; }
  .secret-row { display: flex; align-items: center; justify-content: space-between; }
  .toggle {
    font-size: 12px;
    color: var(--accent);
    background: none;
    border: none;
    cursor: pointer;
    font-weight: 600;
    padding: 2px 4px;
  }
  .toggle:hover { text-decoration: underline; }
  button.submit {
    width: 100%;
    font: inherit;
    font-size: 14.5px;
    font-weight: 650;
    color: #fff;
    background: var(--accent);
    border: none;
    border-radius: 12px;
    padding: 13px;
    cursor: pointer;
    margin-top: 4px;
    transition: transform 0.12s ease, box-shadow 0.18s ease, background 0.18s ease;
    box-shadow: 0 8px 20px -6px rgba(109, 94, 240, 0.6);
  }
  button.submit:hover { transform: translateY(-1px); box-shadow: 0 12px 26px -6px rgba(109, 94, 240, 0.7); }
  button.submit:active { transform: translateY(0) scale(0.99); }
  .foot { margin-top: 16px; font-size: 11.5px; color: var(--muted); line-height: 1.5; text-align: center; }
  .vault { font-family: "SF Mono", ui-monospace, monospace; color: var(--accent); font-weight: 600; }
  /* multi-field rows */
  select {
    font: inherit; font-size: 13px; color: var(--ink); background: #fff;
    border: 1.5px solid var(--line); border-radius: 10px; padding: 0 8px; height: 38px;
    cursor: pointer; outline: none; transition: border-color 0.18s ease, box-shadow 0.18s ease;
  }
  select:focus { border-color: var(--accent); box-shadow: 0 0 0 4px var(--accent-soft); }
  .frow {
    border: 1.5px solid var(--line); border-radius: 14px; padding: 11px;
    margin-bottom: 10px; background: rgba(255, 255, 255, 0.5);
  }
  .frow-top { display: flex; gap: 8px; margin-bottom: 8px; align-items: center; }
  .frow-top .fname { flex: 1; min-width: 0; }
  .rm {
    flex: 0 0 auto; width: 32px; height: 32px; border: none; background: none;
    color: var(--muted); font-size: 20px; line-height: 1; cursor: pointer; border-radius: 8px;
  }
  .rm:hover { color: var(--err); background: #fdecec; }
  .frow-val { position: relative; }
  .frow-val textarea { min-height: 46px; }
  .peek {
    position: absolute; top: 9px; right: 11px; font-size: 11px; color: var(--accent);
    background: rgba(255, 255, 255, 0.85); border: none; cursor: pointer; font-weight: 600;
    padding: 2px 7px; border-radius: 6px;
  }
  .peek:hover { text-decoration: underline; }
  .addbtn {
    width: 100%; font: inherit; font-size: 13px; font-weight: 600; color: var(--accent);
    background: var(--accent-soft); border: none; border-radius: 10px; padding: 9px;
    cursor: pointer; margin-bottom: 16px; transition: filter 0.15s ease;
  }
  .addbtn:hover { filter: brightness(0.97); }
  /* result states */
  .result { text-align: center; padding: 8px 0 4px; }
  .check { width: 64px; height: 64px; margin: 4px auto 14px; }
  .check circle {
    stroke: var(--ok); stroke-width: 5; fill: none;
    stroke-dasharray: 166; stroke-dashoffset: 166;
    animation: draw 0.5s cubic-bezier(0.65, 0, 0.45, 1) forwards;
  }
  .check path {
    stroke: var(--ok); stroke-width: 6; fill: none;
    stroke-linecap: round; stroke-linejoin: round;
    stroke-dasharray: 48; stroke-dashoffset: 48;
    animation: draw 0.35s cubic-bezier(0.65, 0, 0.45, 1) 0.45s forwards;
  }
  @keyframes draw { to { stroke-dashoffset: 0; } }
  .cross { width: 56px; height: 56px; margin: 4px auto 14px; }
  .cross circle { stroke: var(--err); stroke-width: 5; fill: none; }
  .cross path { stroke: var(--err); stroke-width: 6; fill: none; stroke-linecap: round; }
  .err-detail {
    font-family: "SF Mono", ui-monospace, monospace;
    font-size: 12px;
    color: var(--err);
    background: #fdecec;
    border-radius: 10px;
    padding: 10px 12px;
    margin-top: 12px;
    text-align: left;
    white-space: pre-wrap;
    word-break: break-word;
  }
</style>
</head>
<body>
  <div class="card">
${inner}
  </div>
</body>
</html>`;

export function renderPage(
  initialTitle: string,
  vault: string,
  presetFields: { name: string; type: string }[] = [],
): string {
  // Preset rows are serialised into the page as JS — names/types only, never
  // a value. Escape `<` so a field name can't break out of the <script> tag.
  const presetJson = JSON.stringify(presetFields).replace(/</g, "\\u003c");
  return SHELL(`
    <span class="badge"><span class="dot"></span>secret-tap</span>
    <h1>Drop a secret in</h1>
    <p class="sub">Paste it below — straight into Proton Pass on this machine, nothing else
      sees it. More than one value? Add typed fields (an S3 key&nbsp;+&nbsp;secret,
      a user&nbsp;+&nbsp;pass&nbsp;+&nbsp;endpoint&hellip;).</p>
    <form method="POST" autocomplete="off">
      <div class="field">
        <label for="title">Item title</label>
        <input type="text" id="title" name="title" value="${escapeHtml(initialTitle)}"
          placeholder="scope-resource-purpose" required autocomplete="off" spellcheck="false" />
      </div>
      <label>Fields</label>
      <div id="fields"></div>
      <button type="button" class="addbtn" id="addfield">+ Add field</button>
      <button type="submit" class="submit">Store in Proton Pass &rarr;</button>
    </form>
    <p class="foot">Vault: <span class="vault">${escapeHtml(vault)}</span> &middot;
      single-use &middot; this tab self-destructs after submit</p>

    <template id="rowtpl">
      <div class="frow">
        <div class="frow-top">
          <input class="fname" type="text" name="fname" placeholder="field name (e.g. access-key-id)"
            autocomplete="off" spellcheck="false" />
          <select class="ftype" name="ftype">
            <option value="hidden">Secret</option>
            <option value="text">Text</option>
            <option value="totp">TOTP</option>
            <option value="timestamp">Timestamp</option>
          </select>
          <button type="button" class="rm" title="remove field" aria-label="remove field">&times;</button>
        </div>
        <div class="frow-val">
          <textarea class="fvalue" name="fvalue" placeholder="value"
            autocomplete="off" spellcheck="false"></textarea>
          <button type="button" class="peek">show</button>
        </div>
      </div>
    </template>

    <script>
      const fieldsEl = document.getElementById('fields');
      const tpl = document.getElementById('rowtpl');

      function applyType(row) {
        const hidden = row.querySelector('.ftype').value === 'hidden';
        const ta = row.querySelector('.fvalue');
        const peek = row.querySelector('.peek');
        ta.classList.toggle('masked', hidden);
        peek.style.display = hidden ? '' : 'none';
        peek.textContent = 'show';
      }

      function refreshRemovable() {
        const rows = fieldsEl.querySelectorAll('.frow');
        rows.forEach(function (r) {
          r.querySelector('.rm').style.visibility = rows.length > 1 ? 'visible' : 'hidden';
        });
      }

      function addRow(name, type) {
        const row = tpl.content.firstElementChild.cloneNode(true);
        row.querySelector('.fname').value = name || '';
        row.querySelector('.ftype').value = type || 'text';
        fieldsEl.appendChild(row);
        applyType(row);
        refreshRemovable();
        return row;
      }

      fieldsEl.addEventListener('change', function (e) {
        if (e.target.classList.contains('ftype')) applyType(e.target.closest('.frow'));
      });
      fieldsEl.addEventListener('click', function (e) {
        if (e.target.classList.contains('rm')) {
          if (fieldsEl.querySelectorAll('.frow').length > 1) {
            e.target.closest('.frow').remove();
            refreshRemovable();
          }
        } else if (e.target.classList.contains('peek')) {
          const ta = e.target.closest('.frow').querySelector('.fvalue');
          const masked = ta.classList.toggle('masked');
          e.target.textContent = masked ? 'show' : 'hide';
        }
      });
      document.getElementById('addfield').addEventListener('click', function () {
        addRow('', 'text').querySelector('.fname').focus();
      });

      // Preset rows from --field flags (names + types only), else one secret
      // field named "password" → the untouched single-secret case stores a
      // login item, identical to the original behaviour.
      const PRESET_FIELDS = ${presetJson};
      let first;
      if (PRESET_FIELDS.length) {
        PRESET_FIELDS.forEach(function (f) {
          const r = addRow(f.name, f.type);
          if (!first) first = r;
        });
      } else {
        first = addRow('password', 'hidden');
      }
      const titleEl = document.getElementById('title');
      (titleEl.value ? first.querySelector('.fvalue') : titleEl).focus();
    </script>
  `);
}

export function renderSuccess(
  title: string,
  vault: string,
  action: "stored" | "updated" = "stored",
): string {
  const heading = action === "updated" ? "Updated" : "Stored";
  const verb = action === "updated" ? "was updated in" : "landed in";
  return SHELL(`
    <div class="result">
      <svg class="check" viewBox="0 0 60 60">
        <circle cx="30" cy="30" r="26" />
        <path d="M18 31 l8 8 l16 -18" />
      </svg>
      <h1>${heading} &check;</h1>
      <p class="sub"><span class="vault">${escapeHtml(title)}</span>
        ${verb} the <span class="vault">${escapeHtml(vault)}</span> vault.<br />
        You can close this tab.</p>
    </div>
    <script>
      setTimeout(() => { try { window.close(); } catch (e) {} }, 1900);
    </script>
  `);
}

export function renderError(detail: string): string {
  return SHELL(`
    <div class="result">
      <svg class="cross" viewBox="0 0 60 60">
        <circle cx="30" cy="30" r="26" />
        <path d="M21 21 L39 39 M39 21 L21 39" />
      </svg>
      <h1>Didn't store</h1>
      <p class="sub">The secret was not saved — nothing changed in Proton Pass.</p>
      <div class="err-detail">${escapeHtml(detail)}</div>
      <p class="foot"><a href="" class="vault">&larr; back to the form</a></p>
    </div>
  `);
}
