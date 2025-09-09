// /api/admin/ui.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Covrily – Admin UI</title>
<style>
  :root{--bg:#0b1220;--panel:#121a2b;--muted:#8ea0bf;--text:#e9eefb;--accent:#57a6ff;--ok:#2ecc71;--warn:#ffb020;--err:#ff5c5c}
  *{box-sizing:border-box;font-family:Inter,system-ui,Segoe UI,Arial,sans-serif}
  body{margin:0;background:var(--bg);color:var(--text)}
  .container{max-width:980px;margin:32px auto;padding:0 16px}
  h1{font-size:20px;margin:0 0 16px}
  .card{background:var(--panel);border-radius:10px;padding:16px;margin:12px 0;border:1px solid #1f2a42}
  .row{display:flex;gap:8px;align-items:center;margin:8px 0}
  label{display:block;font-size:12px;color:var(--muted);margin-bottom:6px}
  input,select{width:100%;padding:10px 12px;border-radius:8px;border:1px solid #22314f;background:#0e1730;color:var(--text)}
  button{padding:9px 12px;border-radius:8px;border:1px solid #2a3a5f;background:#162346;color:var(--text);cursor:pointer}
  button.primary{background:var(--accent);border-color:var(--accent);color:#061327}
  button.small{padding:6px 10px;font-size:12px}
  .hint{font-size:11px;color:var(--muted)}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
  textarea{width:100%;min-height:200px;background:#0e1730;color:#dfe8ff;border:1px solid #22314f;border-radius:10px;padding:12px;white-space:pre;overflow:auto}
  .status-ok{color:var(--ok)} .status-warn{color:var(--warn)} .status-err{color:var(--err)}
</style>
</head>
<body>
<div class="container">
  <h1>Covrily – Admin UI</h1>

  <!-- Auth -->
  <div class="card">
    <label>Admin Token</label>
    <div class="row">
      <input id="token" placeholder="ETETOPOP159"/>
      <button id="save" class="primary">Save token</button>
      <button id="clear">Clear</button>
      <button id="ping">Ping</button>
    </div>
    <div class="hint">Token is stored in localStorage on this device only.</div>
  </div>

  <!-- Recent Receipts -->
  <div class="card">
    <h3 style="margin:0 0 8px">Recent Receipts</h3>
    <label>Search (optional)</label>
    <input id="search" placeholder="merchant or order #"/>
    <div class="row">
      <select id="recent"></select>
      <button id="loadRecent" class="small">Load</button>
      <button id="copyRecent" class="small">Copy Receipt ID</button>
    </div>
    <div class="hint">Loads the latest receipts (search filters by merchant/order id).</div>
  </div>

  <!-- Receipt & Link -->
  <div class="card">
    <h3 style="margin:0 0 8px">Receipt & Link</h3>
    <div class="grid">
      <div>
        <label>Receipt ID</label>
        <input id="rid" placeholder="UUID of receipts.id"/>
      </div>
      <div>
        <label>Product URL</label>
        <input id="purl" placeholder="https://example.com/product/123"/>
      </div>
    </div>
    <div class="row">
      <div style="flex:1">
        <label>Merchant Hint</label>
        <input id="mhint" placeholder="Best Buy (optional)"/>
      </div>
      <div style="display:flex;gap:8px;align-items:flex-end">
        <button id="getLink">Get Link</button>
        <button id="upsertLink">Upsert Link</button>
      </div>
    </div>
    <div class="row">
      <button id="snapshot" class="small">Load Receipt</button>
      <div class="hint">Shows currency, tax &amp; shipping from /api/receipts.</div>
    </div>
  </div>

  <!-- Policy Preview -->
  <div class="card">
    <h3 style="margin:0 0 8px">Policy Preview</h3>
    <div class="row">
      <input id="curPrice" placeholder="e.g. 10.00 (optional)"/>
      <button id="preview" class="small">Preview</button>
      <div class="hint">Uses /api/policy/preview</div>
    </div>
  </div>

  <!-- Price Watch -->
  <div class="card">
    <h3 style="margin:0 0 8px">Price Watch</h3>
    <div class="row">
      <input id="mockCents" placeholder="e.g. 1000 = $10.00"/>
      <button id="dryRun" class="small">Dry Run</button>
      <button id="runSend" class="small">Run &amp; Send</button>
      <div class="hint">Uses /api/cron/price-watch</div>
    </div>
  </div>

  <!-- Output -->
  <div class="card">
    <div class="row" style="justify-content:flex-end">
      <button id="outClear" class="small">Clear</button>
      <button id="outCopy" class="small">Copy</button>
    </div>
    <textarea id="out" readonly></textarea>
  </div>
</div>

<script>
  // ----- token helpers -----
  const $ = (id)=>document.getElementById(id);
  const OUT = $("out");
  const LS_KEY = "cov_admin_token";

  function getToken(){ return ($("token").value || localStorage.getItem(LS_KEY) || "").trim(); }
  function setToken(v){ $("token").value=v; localStorage.setItem(LS_KEY, v||""); }

  // log helper
  function log(line){
    const prev = OUT.value.trim();
    OUT.value = (prev ? prev + "\\n" : "") + (typeof line==="string" ? line : JSON.stringify(line, null, 2));
    OUT.scrollTop = OUT.scrollHeight;
  }

  // central fetch helper: add header AND ?token=
  async function fetchJson(url, options={}){
    const t = getToken();
    const final = t ? url + (url.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(t) : url;
    const res = await fetch(final, {
      ...options,
      headers: { ...(options.headers||{}), "x-admin-token": t }
    });
    const text = await res.text();
    let body = text;
    try { body = JSON.parse(text); } catch {}
    log({ url, status: res.status, body: typeof body === "string" ? body.slice(0, 2000) : body });
    return { res, body };
  }

  // init token from localStorage
  setToken(localStorage.getItem(LS_KEY) || "");

  // ----- Auth -----
  $("save").onclick = () => { setToken($("token").value.trim()); log("Token saved."); };
  $("clear").onclick = () => { setToken(""); log("Token cleared."); };
  $("ping").onclick = async () => {
    await fetchJson("/api/diag/env");
    await fetchJson("/api/health");
  };

  // ----- Recent Receipts -----
  $("loadRecent").onclick = async () => {
    const q = $("search").value.trim();
    const url = "/api/receipts?limit=20" + (q ? "&q=" + encodeURIComponent(q) : "");
    const { body } = await fetchJson(url);
    const list = (body && body.receipts) || [];
    const sel = $("recent");
    sel.innerHTML = "";
    list.forEach(r => {
      const opt = document.createElement("option");
      opt.value = r.id;
      opt.textContent = r.merchant + " • " + (r.order_id || "EMPTY") + " • " + (r.total_cents ?? "—");
      sel.appendChild(opt);
    });
  };
  $("copyRecent").onclick = () => {
    const v = $("recent").value || "";
    if (!v) return;
    navigator.clipboard.writeText(v);
    log("Copied: " + v);
    $("rid").value = v;
  };

  // ----- Receipt & Link -----
  $("getLink").onclick = async () => {
    const rid = $("rid").value.trim();
    if (!rid) return log("Set Receipt ID first.");
    await fetchJson("/api/price/link?receipt_id=" + encodeURIComponent(rid));
  };
  $("upsertLink").onclick = async () => {
    const rid = $("rid").value.trim();
    const url = $("purl").value.trim();
    const hint = $("mhint").value.trim();
    if (!rid || !url) return log("Need Receipt ID and Product URL.");
    const qs = new URLSearchParams({ receipt_id: rid, action: "upsert", url, merchant_hint: hint, active: "1" });
    await fetchJson("/api/price/link?" + qs.toString());
  };
  $("snapshot").onclick = async () => {
    const rid = $("rid").value.trim();
    if (!rid) return log("Set Receipt ID first.");
    await fetchJson("/api/receipts?id=" + encodeURIComponent(rid));
  };

  // ----- Policy Preview -----
  $("preview").onclick = async () => {
    const rid = $("rid").value.trim();
    const cur = $("curPrice").value.trim();
    const url = "/api/policy/preview?id=" + encodeURIComponent(rid) + (cur ? "&current_price=" + encodeURIComponent(cur) : "");
    await fetchJson(url);
  };

  // ----- Price Watch -----
  $("dryRun").onclick = async () => {
    const rid = $("rid").value.trim();
    const mock = $("mockCents").value.trim();
    const qs = new URLSearchParams({ receipt_id: rid, dry: "1" });
    if (mock) qs.set("mock_price", mock);
    await fetchJson("/api/cron/price-watch?" + qs.toString());
  };
  $("runSend").onclick = async () => {
    const rid = $("rid").value.trim();
    const mock = $("mockCents").value.trim();
    const qs = new URLSearchParams({ receipt_id: rid });
    if (mock) qs.set("mock_price", mock);
    await fetchJson("/api/cron/price-watch?" + qs.toString());
  };

  // ----- Output helpers -----
  $("outClear").onclick = () => OUT.value = "";
  $("outCopy").onclick = async () => {
    await navigator.clipboard.writeText(OUT.value);
    log("Output copied.");
  };
</script>
</body>
</html>`);
}
