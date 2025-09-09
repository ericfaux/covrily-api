// /api/admin/ui.ts
// Minimal, dependency-free admin console (TS compiled by Vercel)
// Works with the existing endpoints in this project.

import type { VercelRequest, VercelResponse } from "@vercel/node";

const html = /* html */ `
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Covrily – Admin UI</title>
  <style>
    :root {
      --bg: #0e1621;
      --panel: #121d2a;
      --muted: #8aa4bf;
      --text: #e8eef6;
      --accent: #4ea1ff;
      --btn: #223147;
      --btnH: #334861;
      --ok: #25c59f;
      --warn: #ffcb6b;
      --err: #ff6b6b;
      --border: #233247;
    }
    * { box-sizing: border-box; }
    html, body { height: 100%; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font: 14px/1.4 system-ui, -apple-system, Segoe UI, Roboto, Inter, sans-serif;
    }
    .wrap { max-width: 980px; margin: 24px auto; padding: 0 16px; }
    h1 { margin: 0 0 12px; font-weight: 600; font-size: 20px; }
    section {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 14px 16px;
      margin: 12px 0 18px;
    }
    .row { display: grid; grid-template-columns: 1fr auto auto; gap: 8px; align-items: center; }
    .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .row3 { display: grid; grid-template-columns: 1fr auto auto auto; gap: 8px; align-items: center; }
    .row4 { display: grid; grid-template-columns: 1fr 1fr auto auto; gap: 8px; align-items: center; }
    label { display:block; font-size: 12px; color: var(--muted); margin: 4px 0; }
    input, select {
      width: 100%;
      background: #0c1420;
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px 11px;
      outline: none;
    }
    input:focus, select:focus { border-color: var(--accent); }
    button {
      background: var(--btn);
      color: var(--text);
      border: 1px solid var(--border);
      padding: 10px 12px;
      border-radius: 8px;
      cursor: pointer;
      min-width: 64px;
    }
    button:hover { background: var(--btnH); }
    .help { color: var(--muted); font-size: 12px; margin-top: 6px; }
    .out {
      background: #0b121c;
      border: 1px solid var(--border);
      border-radius: 10px;
      min-height: 220px;
      padding: 12px;
      white-space: pre-wrap;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      overflow: auto;
    }
    .btn-sm { padding: 8px 10px; font-size: 13px; }
    .toolbar { display:flex; gap:8px; justify-content:flex-end; margin-top:8px; }
    .pill { color: var(--muted); font-size: 12px; margin-left: 6px; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>Covrily – Admin UI</h1>

    <!-- AUTH -->
    <section>
      <div class="row">
        <div>
          <label>Admin Token</label>
          <input id="token" placeholder="ETET...">
        </div>
        <button id="btn-save">Save token</button>
        <div class="row" style="grid-template-columns:auto auto">
          <button id="btn-clear" class="btn-sm">Clear</button>
          <button id="btn-ping" class="btn-sm">Ping</button>
        </div>
      </div>
      <div class="help">Token is stored in localStorage on this device only.</div>
    </section>

    <!-- RECENT RECEIPTS -->
    <section>
      <div class="row3">
        <div>
          <label>Search (optional)</label>
          <input id="q" placeholder="merchant or order #">
        </div>
        <button id="btn-load" class="btn-sm">Load</button>
        <button id="btn-copy-id" class="btn-sm">Copy Receipt ID</button>
      </div>
      <div style="height:8px"></div>
      <div class="row">
        <select id="recent"></select>
        <span class="pill" id="recent-count">(loaded)</span>
        <span></span>
      </div>
      <div class="help">Loads the latest receipts (search filters by merchant/order id).</div>
    </section>

    <!-- RECEIPT & LINK -->
    <section>
      <div class="row2">
        <div>
          <label>Receipt ID</label>
          <input id="rid" placeholder="UUID of receipts.id">
        </div>
        <div>
          <label>Product URL</label>
          <input id="prodUrl" placeholder="https://example.com/product/123">
        </div>
      </div>
      <div style="height:8px"></div>
      <div class="row4">
        <div>
          <label>Merchant Hint</label>
          <input id="hint" placeholder="Best Buy (optional)">
        </div>
        <button id="btn-getlink">Get Link</button>
        <button id="btn-upsert">Upsert Link</button>
        <button id="btn-load-rx">Load Receipt</button>
      </div>
      <div class="help">Shows currency, tax & shipping from /api/receipts.</div>
    </section>

    <!-- POLICY PREVIEW -->
    <section>
      <div class="row3">
        <div>
          <label>Current Price ($)</label>
          <input id="curPrice" placeholder="e.g. 10.00 (optional)">
        </div>
        <button id="btn-preview">Preview</button>
        <span class="help">Uses /api/policy/preview</span>
      </div>
    </section>

    <!-- PRICE WATCH -->
    <section>
      <div class="row3">
        <div>
          <label>Mock Price (cents)</label>
          <input id="mock" placeholder="e.g. 1000 = $10.00">
        </div>
        <button id="btn-dry">Dry Run</button>
        <button id="btn-send">Run &amp; Send</button>
      </div>
      <div class="help">Uses /api/cron/price-watch</div>
    </section>

    <!-- OUTPUT -->
    <section>
      <div class="toolbar">
        <button id="btn-clear-out" class="btn-sm">Clear</button>
        <button id="btn-copy-out" class="btn-sm">Copy</button>
      </div>
      <div id="out" class="out"></div>
    </section>
  </div>

<script>
(() => {
  const $ = (id) => document.getElementById(id);
  const out = $("out");

  // ---- Local storage token
  const LS_KEY = "covrily_admin_token";
  const getToken = () => ($("token").value || "").trim();
  const setToken = (t) => { $("token").value = t || ""; };

  // ---- Helpers
  const log = (obj) => {
    try { out.textContent += (typeof obj === "string" ? obj : JSON.stringify(obj, null, 2)) + "\\n\\n"; }
    catch { out.textContent += String(obj) + "\\n\\n"; }
    out.scrollTop = out.scrollHeight;
  };
  const clearOut = () => { out.textContent = ""; };
  const copyOut = async () => {
    try { await navigator.clipboard.writeText(out.textContent); } catch {}
  };
  const adminFetch = async (url) => {
    const token = getToken();
    const headers = { "x-admin-token": token || "" };
    const res = await fetch(url, { headers });
    let bodyText = "";
    let body = null;
    try { body = await res.json(); bodyText = JSON.stringify(body); }
    catch { bodyText = await res.text(); }
    return { url, status: res.status, body, bodyText };
  };
  const ensureRid = () => {
    let rid = $("rid").value.trim();
    if (!rid) {
      const sel = $("recent");
      rid = (sel && sel.value) ? sel.value : "";
      $("rid").value = rid;
    }
    return rid;
  };
  const parseDollars = (s) => {
    if (!s) return null;
    const num = parseFloat(String(s).replace(/[^\\d.]/g,""));
    return isFinite(num) ? Math.round(num * 100) : null;
  };

  // ---- Load from localStorage
  setToken(localStorage.getItem(LS_KEY) || "");

  // ---- Buttons
  $("btn-save").addEventListener("click", () => {
    localStorage.setItem(LS_KEY, getToken());
    log("Token saved.");
  });
  $("btn-clear").addEventListener("click", () => { setToken(""); localStorage.removeItem(LS_KEY); log("Token cleared."); });

  $("btn-ping").addEventListener("click", async () => {
    clearOut();
    const a = await adminFetch("/api/diag/env?token=" + encodeURIComponent(getToken()));
    log(a);
    const b = await adminFetch("/api/health?token=" + encodeURIComponent(getToken()));
    log(b);
  });

  $("btn-clear-out").addEventListener("click", clearOut);
  $("btn-copy-out").addEventListener("click", copyOut);

  $("btn-load").addEventListener("click", async () => {
    const q = $("q").value.trim();
    const url = "/api/receipts" + (q ? ("?search=" + encodeURIComponent(q)) : "");
    const r = await adminFetch(url);
    log(r);
    const sel = $("recent");
    sel.innerHTML = "";
    const items = (r.body && (r.body.receipts || r.body.rows || r.body.items)) || [];
    if (!Array.isArray(items) || items.length === 0) {
      $("recent-count").textContent = "(0 loaded)";
      return;
    }
    items.forEach((rec) => {
      const opt = document.createElement("option");
      opt.value = rec.id || rec.receipt_id || "";
      const label = [
        rec.merchant || rec.merchant_hint || "merchant",
        rec.order_id || "",
        rec.total_cents != null ? "$" + (rec.total_cents/100).toFixed(2) : ""
      ].filter(Boolean).join("  •  ");
      opt.textContent = label;
      sel.appendChild(opt);
    });
    $("recent-count").textContent = "(" + items.length + " loaded)";
  });

  $("btn-copy-id").addEventListener("click", async () => {
    const rid = ensureRid();
    if (!rid) { log("No receipt id to copy."); return; }
    try { await navigator.clipboard.writeText(rid); log("Receipt ID copied."); } catch { log("Copy failed."); }
  });

  $("btn-load-rx").addEventListener("click", async () => {
    const rid = ensureRid();
    if (!rid) { log("Missing receipt id."); return; }
    const r = await adminFetch("/api/receipts?id=" + encodeURIComponent(rid));
    log(r);
  });

  $("btn-getlink").addEventListener("click", async () => {
    const rid = ensureRid();
    if (!rid) { log("Missing receipt id."); return; }
    const r = await adminFetch("/api/price/link?receipt_id=" + encodeURIComponent(rid));
    log(r);
  });

  $("btn-upsert").addEventListener("click", async () => {
    const rid = ensureRid();
    if (!rid) { log("Missing receipt id."); return; }
    const url = $("prodUrl").value.trim();
    const hint = $("hint").value.trim();
    const qs = new URLSearchParams({
      receipt_id: rid,
      action: "upsert",
      url,
      merchant_hint: hint,
      active: "1"
    }).toString();
    const r = await adminFetch("/api/price/link?" + qs);
    log(r);
  });

  $("btn-preview").addEventListener("click", async () => {
    const rid = ensureRid();
    if (!rid) { log("Missing receipt id."); return; }
    const dollars = $("curPrice").value.trim();
    const qs = new URLSearchParams({ id: rid });
    if (dollars) {
      const cents = parseDollars(dollars);
      if (cents != null) qs.set("current_price", String(cents / 100)); // preview endpoint expects dollars in this project
    }
    const r = await adminFetch("/api/policy/preview?" + qs.toString());
    log(r);
  });

  $("btn-dry").addEventListener("click", async () => {
    const rid = ensureRid();
    if (!rid) { log("Missing receipt id."); return; }
    const mock = $("mock").value.trim();
    const qs = new URLSearchParams({
      receipt_id: rid,
      mock_price: mock || "",
      dry: "1"
    });
    const r = await adminFetch("/api/cron/price-watch?" + qs.toString());
    log(r);
  });

  $("btn-send").addEventListener("click", async () => {
    const rid = ensureRid();
    if (!rid) { log("Missing receipt id."); return; }
    const mock = $("mock").value.trim();
    const qs = new URLSearchParams({
      receipt_id: rid,
      mock_price: mock || ""
    });
    const r = await adminFetch("/api/cron/price-watch?" + qs.toString());
    log(r);
  });
})();
</script>
</body>
</html>
`;

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.status(200).send(html);
}
