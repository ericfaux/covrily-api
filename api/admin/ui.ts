// api/admin/ui.ts
import type { VercelRequest, VercelResponse } from "vercel";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Light guard so the page itself isn’t publicly discoverable.
  const token = (req.query.token as string) || "";
  if (!token) {
    res.setHeader("content-type", "text/html; charset=utf-8");
    return res.status(200).send(`<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{font-family:ui-sans-serif,system-ui,Segoe UI,Roboto,Helvetica,Arial;max-width:900px;margin:30px auto;padding:0 16px}
.card{border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin:16px 0}
h1{font-size:20px;margin:0 0 8px} h2{font-size:16px;margin:16px 0 8px}
input,button,textarea{font:inherit} input,textarea{width:100%;box-sizing:border-box;padding:8px;border:1px solid #e5e7eb;border-radius:8px}
.row{display:grid;grid-template-columns:160px 1fr;gap:12px;align-items:center;margin:8px 0}
.btn{padding:8px 12px;border:1px solid #111827;border-radius:10px;cursor:pointer;background:#111827;color:#fff}
.btn.alt{background:#fff;color:#111827}
pre{background:#0b1220;color:#e6edf3;border-radius:12px;padding:12px;overflow:auto;max-height:320px}</style>
<h1>Covrily – Admin UI</h1>
<p><b>Missing token.</b> Add <code>?token=&lt;ADMIN_TOKEN&gt;</code> to the URL once, the page will remember it.</p>
`);
  }

  res.setHeader("content-type", "text/html; charset=utf-8");
  return res.status(200).send(`<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Covrily Admin UI</title>
<style>
body{font-family:ui-sans-serif,system-ui,Segoe UI,Roboto,Helvetica,Arial;max-width:980px;margin:30px auto;padding:0 16px}
.card{border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin:16px 0}
h1{font-size:22px;margin:0 0 8px} h2{font-size:16px;margin:16px 0 8px}
input,button,textarea{font:inherit} input,textarea{width:100%;box-sizing:border-box;padding:8px;border:1px solid #e5e7eb;border-radius:8px}
.row{display:grid;grid-template-columns:180px 1fr;gap:12px;align-items:center;margin:8px 0}
.btn{padding:8px 12px;border:1px solid #111827;border-radius:10px;cursor:pointer;background:#111827;color:#fff}
.btn.alt{background:#fff;color:#111827}
pre{background:#0b1220;color:#e6edf3;border-radius:12px;padding:12px;overflow:auto;max-height:360px}
small{color:#6b7280}
</style>

<h1>Covrily – Admin UI</h1>

<div class="card">
  <h2>Auth</h2>
  <div class="row"><label>Admin Token</label><input id="token" placeholder="x-admin-token" /></div>
  <div><button class="btn" onclick="saveToken()">Save token</button>
      <button class="btn alt" onclick="clearToken()">Clear</button></div>
  <small>Token is stored in localStorage on this device only.</small>
</div>

<div class="card">
  <h2>Receipt & Link</h2>
  <div class="row"><label>Receipt ID</label><input id="rid" placeholder="UUID of receipts.id" /></div>
  <div class="row"><label>Product URL</label><input id="url" placeholder="https://example.com/product/123" /></div>
  <div class="row"><label>Merchant Hint</label><input id="hint" placeholder="Best Buy (optional)" /></div>
  <div>
    <button class="btn" onclick="getLink()">Get Link</button>
    <button class="btn" onclick="upsertLink()">Upsert Link</button>
  </div>
</div>

<div class="card">
  <h2>Policy Preview</h2>
  <div class="row"><label>Current Price ($)</label><input id="cur" placeholder="e.g. 10.00 (optional)" /></div>
  <div>
    <button class="btn" onclick="preview()">Preview</button>
  </div>
</div>

<div class="card">
  <h2>Price Watch</h2>
  <div class="row"><label>Mock Price (cents)</label><input id="mock" placeholder="e.g. 1000 = $10.00" /></div>
  <div>
    <button class="btn" onclick="watchDry()">Dry Run</button>
    <button class="btn" onclick="watchSend()">Run & Send</button>
  </div>
</div>

<div class="card">
  <h2>Decisions</h2>
  <div>
    <button class="btn" onclick="listDecisions()">List</button>
    <button class="btn" onclick="createDecision('keep')">Create KEEP</button>
    <button class="btn" onclick="createDecision('return')">Create RETURN</button>
    <button class="btn" onclick="createDecision('price_adjust')">Create PRICE_ADJUST</button>
  </div>
</div>

<div class="card">
  <h2>Observations</h2>
  <button class="btn" onclick="listObs()">List Observations</button>
</div>

<div class="card">
  <h2>Output</h2>
  <pre id="out">Ready.</pre>
</div>

<script>
const $ = (id)=>document.getElementById(id);
(function init(){
  const url = new URL(location.href);
  const tokenQ = url.searchParams.get("token");
  if(tokenQ){ localStorage.setItem("covrily_admin_token", tokenQ); }
  $("token").value = localStorage.getItem("covrily_admin_token") || tokenQ || "";
})();
function log(obj){ $("out").textContent = (typeof obj==='string')?obj:JSON.stringify(obj,null,2); }
function tok(){ return $("token").value || localStorage.getItem("covrily_admin_token") || ""; }
function saveToken(){ localStorage.setItem("covrily_admin_token", $("token").value.trim()); log("Token saved"); }
function clearToken(){ localStorage.removeItem("covrily_admin_token"); $("token").value=""; log("Token cleared"); }
function rid(){ return $("rid").value.trim(); }
async function api(path, opts={}){
  const t = tok(); if(!t){ log("Set token first"); throw new Error("no token"); }
  const headers = Object.assign({ "x-admin-token": t }, opts.headers||{});
  const res = await fetch(path, Object.assign({}, opts, { headers }));
  const txt = await res.text();
  try { return JSON.parse(txt); } catch { return { raw: txt }; }
}
async function getLink(){
  const r = rid(); if(!r) return log("Missing receipt id");
  const out = await api(\`/api/price/link?receipt_id=\${encodeURIComponent(r)}\`);
  log(out);
}
async function upsertLink(){
  const r = rid(); const u = $("url").value.trim(); const h = $("hint").value.trim();
  if(!r||!u) return log("Need receipt id and url");
  const out = await api(\`/api/price/link?receipt_id=\${encodeURIComponent(r)}&action=upsert&url=\${encodeURIComponent(u)}&merchant_hint=\${encodeURIComponent(h)}&active=1\`);
  log(out);
}
async function preview(){
  const r = rid(); if(!r) return log("Missing receipt id");
  const cur = $("cur").value.trim();
  const qs = cur ? \`&current_price=\${encodeURIComponent(cur)}\` : "";
  const out = await fetch(\`/api/policy/preview?id=\${encodeURIComponent(r)}\${qs}\`).then(r=>r.json());
  log(out);
}
async function watchDry(){
  const r = rid(); if(!r) return log("Missing receipt id");
  const m = $("mock").value.trim(); if(!m) return log("Enter mock price in cents");
  const out = await api(\`/api/cron/price-watch?receipt_id=\${encodeURIComponent(r)}&mock_price=\${encodeURIComponent(m)}&dry=1\`);
  log(out);
}
async function watchSend(){
  const r = rid(); if(!r) return log("Missing receipt id");
  const m = $("mock").value.trim(); if(!m) return log("Enter mock price in cents");
  const out = await api(\`/api/cron/price-watch?receipt_id=\${encodeURIComponent(r)}&mock_price=\${encodeURIComponent(m)}\`);
  log(out);
}
async function listDecisions(){
  const r = rid(); if(!r) return log("Missing receipt id");
  const out = await api(\`/api/decisions?receipt_id=\${encodeURIComponent(r)}&action=list\`);
  log(out);
}
async function createDecision(kind){
  const r = rid(); if(!r) return log("Missing receipt id");
  const out = await api(\`/api/decisions?receipt_id=\${encodeURIComponent(r)}&action=create&decision=\${encodeURIComponent(kind)}\`);
  log(out);
}
async function listObs(){
  const r = rid(); if(!r) return log("Missing receipt id");
  const out = await api(\`/api/price/observations?receipt_id=\${encodeURIComponent(r)}\`);
  log(out);
}
</script>
`);
}
