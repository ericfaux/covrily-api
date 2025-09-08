// api/admin/ui.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const tokenQ = (req.query.token as string) || "";

  res.setHeader("content-type", "text/html; charset=utf-8");
  return res.status(200).send(`<!doctype html>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Covrily Admin</title>
<style>
:root{
  --bg:#0b1220; --card:#0e1629; --text:#e6edf3; --muted:#99a3b3; --border:#1f2a44; --accent:#5b9dff; --success:#22c55e; --warn:#f59e0b; --danger:#ef4444;
}
:root.light{
  --bg:#f8fafc; --card:#ffffff; --text:#0f172a; --muted:#64748b; --border:#e5e7eb; --accent:#2563eb; --success:#16a34a; --warn:#d97706; --danger:#dc2626;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0;height:100%}
body{font-family:ui-sans-serif, system-ui, Segoe UI, Roboto, Helvetica, Arial; background:var(--bg); color:var(--text)}
a{color:var(--accent);text-decoration:none}
.wrap{max-width:1100px;margin:0 auto;padding:24px}
.header{
  display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;
}
.brand{
  display:flex;align-items:center;gap:12px;
}
.logo{
  width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,#6ee7ff,#5b9dff 55%,#a78bfa); border:1px solid rgba(255,255,255,.15);
  box-shadow:0 10px 18px rgba(0,0,0,.25) inset, 0 2px 6px rgba(0,0,0,.2);
}
.title{font-weight:700;font-size:20px}
.badge{font-size:12px;padding:2px 8px;border:1px solid var(--border);border-radius:999px;color:var(--muted)}
.theme{
  display:flex;gap:8px;align-items:center
}
button, input{
  font:inherit;
}
.btn{
  padding:8px 12px;border:1px solid var(--border);background:var(--text);color:var(--bg);
  border-radius:10px;cursor:pointer;transition:.15s transform ease;
}
.btn:active{transform:translateY(1px)}
.btn.ghost{background:transparent;color:var(--text)}
.btn.primary{background:var(--accent);color:#fff;border-color:transparent}
.btn.success{background:var(--success);color:#fff;border-color:transparent}
.btn.warn{background:var(--warn);color:#fff;border-color:transparent}
.btn.danger{background:var(--danger);color:#fff;border-color:transparent}
.btn.sm{padding:6px 10px;font-size:12px;border-radius:8px}

.grid{
  display:grid;gap:16px;grid-template-columns:1fr;
}
.card{
  background:var(--card);border:1px solid var(--border);border-radius:14px;padding:16px;
}
h2{margin:0 0 10px;font-size:16px}
.row{display:grid;grid-template-columns:180px 1fr;gap:12px;align-items:center;margin:10px 0}
input, select{
  width:100%;padding:10px;border:1px solid var(--border);border-radius:10px;background:transparent;color:var(--text)
}
.help{color:var(--muted);font-size:12px;margin-top:6px}

.kv{font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size:12px;color:var(--muted)}
.toolbar{display:flex;gap:8px;flex-wrap:wrap}
hr{border:none;border-top:1px solid var(--border);margin:12px 0}

.output{
  position:sticky;bottom:0;left:0;right:0;margin-top:16px;
  background:var(--card);border:1px solid var(--border);border-radius:14px;padding:12px;
}
pre{margin:0;background:transparent;color:var(--text);max-height:340px;overflow:auto;}
.controls{display:flex;gap:8px;align-items:center;margin-bottom:8px}
.small{font-size:12px;color:var(--muted)}
.toast{
  position:fixed; right:20px; bottom:20px; background:var(--card); border:1px solid var(--border);
  color:var(--text); padding:10px 12px; border-radius:12px; box-shadow:0 10px 25px rgba(0,0,0,.3);
  opacity:0; transform:translateY(8px); transition:.2s; z-index:9999;
}
.toast.show{opacity:1; transform:translateY(0)}
.spin{display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,.5);border-top-color:#fff;border-radius:50%;animation:spin 1s linear infinite;margin-left:8px}
@keyframes spin{to{transform:rotate(360deg)}}
</style>

<div class="wrap">
  <div class="header">
    <div class="brand">
      <div class="logo"></div>
      <div>
        <div class="title">Covrily – Admin</div>
        <div class="badge">Internal tools</div>
      </div>
    </div>
    <div class="theme">
      <span class="small">Theme</span>
      <button class="btn sm ghost" id="themeBtn">Toggle</button>
    </div>
  </div>

  <div class="grid">

    <div class="card">
      <h2>Auth</h2>
      <div class="row"><label>Admin Token</label><input id="token" placeholder="x-admin-token" /></div>
      <div class="toolbar">
        <button class="btn primary" onclick="saveToken()">Save token</button>
        <button class="btn ghost" onclick="clearToken()">Clear</button>
        <button class="btn ghost" onclick="ping()" id="pingBtn">Ping<span class="spin" id="pingSpin" style="display:none"></span></button>
      </div>
      <div class="help">Token is stored in localStorage on this device only.</div>
    </div>

    <div class="card">
      <h2>Recent Receipts</h2>
      <div class="row"><label>Search (optional)</label><input id="q" placeholder="merchant or order #" /></div>
      <div class="row"><label>Pick one</label>
        <select id="receiptPick"><option value="">(load receipts)</option></select>
      </div>
      <div class="toolbar">
        <button class="btn" onclick="loadReceipts()" id="loadBtn">Load<span class="spin" id="loadSpin" style="display:none"></span></button>
        <button class="btn ghost" onclick="copyRid()">Copy Receipt ID</button>
      </div>
      <div class="help">Loads the latest receipts (search filters by merchant/order id).</div>
    </div>

    <div class="card">
      <h2>Receipt & Link</h2>
      <div class="row"><label>Receipt ID</label><input id="rid" placeholder="UUID of receipts.id" /></div>
      <div class="row"><label>Product URL</label><input id="url" placeholder="https://example.com/product/123" /></div>
      <div class="row"><label>Merchant Hint</label><input id="hint" placeholder="Best Buy (optional)" /></div>
      <div class="toolbar">
        <button class="btn" onclick="getLink()" id="getLinkBtn">Get Link<span class="spin" id="getLinkSpin" style="display:none"></span></button>
        <button class="btn" onclick="upsertLink()" id="upsertBtn">Upsert Link<span class="spin" id="upsertSpin" style="display:none"></span></button>
      </div>
    </div>

    <div class="card">
      <h2>Policy Preview</h2>
      <div class="row"><label>Current Price ($)</label><input id="cur" placeholder="e.g. 10.00 (optional)" /></div>
      <div class="toolbar">
        <button class="btn" onclick="preview()" id="previewBtn">Preview<span class="spin" id="previewSpin" style="display:none"></span></button>
      </div>
    </div>

    <div class="card">
      <h2>Price Watch</h2>
      <div class="row"><label>Mock Price (cents)</label><input id="mock" placeholder="e.g. 1000 = $10.00" /></div>
      <div class="toolbar">
        <button class="btn" onclick="watchDry()" id="dryBtn">Dry Run<span class="spin" id="drySpin" style="display:none"></span></button>
        <button class="btn success" onclick="watchSend()" id="sendBtn">Run & Send<span class="spin" id="sendSpin" style="display:none"></span></button>
      </div>
    </div>

    <div class="card">
      <h2>Decisions</h2>
      <div class="toolbar">
        <button class="btn" onclick="listDecisions()" id="listDecBtn">List</button>
        <button class="btn ghost" onclick="createDecision('keep')">Create KEEP</button>
        <button class="btn ghost" onclick="createDecision('return')">Create RETURN</button>
        <button class="btn ghost" onclick="createDecision('price_adjust')">Create PRICE_ADJUST</button>
      </div>
    </div>

    <div class="output">
      <div class="controls">
        <div class="small">Output</div>
        <div style="flex:1"></div>
        <button class="btn sm ghost" onclick="clearOut()">Clear</button>
        <button class="btn sm ghost" onclick="copyOut()">Copy</button>
      </div>
      <pre id="out">Ready.</pre>
    </div>

  </div>
</div>

<div id="toast" class="toast"></div>

<script>
const $ = (id)=>document.getElementById(id);
const ORIGIN = location.origin;

(function init(){
  // theme
  const t = localStorage.getItem("covrily_theme") || "dark";
  if (t === "light") document.documentElement.classList.add("light");
  $("themeBtn").addEventListener("click", () => {
    const light = document.documentElement.classList.toggle("light");
    localStorage.setItem("covrily_theme", light ? "light":"dark");
  });

  // token priming
  const url = new URL(location.href);
  const tokenQ = url.searchParams.get("token") || "${tokenQ}";
  if(tokenQ){ localStorage.setItem("covrily_admin_token", tokenQ); }
  $("token").value = localStorage.getItem("covrily_admin_token") || tokenQ || "";

  // link picker on change
  $("receiptPick").addEventListener("change", () => {
    const v = $("receiptPick").value;
    if(v){ $("rid").value = v; toast("Receipt selected"); }
  });

  // initial load
  setTimeout(loadReceipts, 50);
})();

function toast(msg){
  const el = $("toast"); el.textContent = msg; el.classList.add("show");
  setTimeout(()=>el.classList.remove("show"), 1600);
}
function log(obj){
  try{
    $("out").textContent = (typeof obj==='string') ? obj : JSON.stringify(obj, null, 2);
    const pre = $("out"); pre.scrollTop = pre.scrollHeight;
  }catch{ $("out").textContent = String(obj); }
}
function clearOut(){ $("out").textContent = "Cleared."; }
async function copyOut(){ await navigator.clipboard.writeText($("out").textContent); toast("Output copied"); }

function tok(){ return $("token").value || localStorage.getItem("covrily_admin_token") || ""; }
function saveToken(){ localStorage.setItem("covrily_admin_token", $("token").value.trim()); toast("Token saved"); }
function clearToken(){ localStorage.removeItem("covrily_admin_token"); $("token").value=""; toast("Token cleared"); }
async function copyRid(){ if(!$("rid").value.trim()) return toast("No receipt id"); await navigator.clipboard.writeText($("rid").value.trim()); toast("Receipt ID copied"); }
function rid(){ return $("rid").value.trim(); }

async function api(path, opts={}){
  const t = tok();
  if(!t){ toast("Set token first"); throw new Error("no token"); }
  const res = await fetch(ORIGIN + path, {
    method: opts.method || "GET",
    headers: Object.assign({ "x-admin-token": t, "accept":"application/json" }, opts.headers || {}),
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    cache: "no-store", credentials: "same-origin",
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if(!res.ok) return { ok:false, status:res.status, ...data };
  return data;
}

async function withSpin(id, fn){
  const btn = $(id); const spin = $(id.replace(/Btn$/,"Spin"));
  if (spin) spin.style.display = "inline-block";
  btn && (btn.disabled = true);
  try { return await fn(); }
  finally { if (spin) spin.style.display = "none"; btn && (btn.disabled = false); }
}

// --- actions ---
async function ping(){ await withSpin("pingBtn", async ()=>{
  const out = await api("/api/health"); log(out); toast(out.ok ? "OK" : "Error");
}); }

async function loadReceipts(){ await withSpin("loadBtn", async ()=>{
  const q = $("q").value.trim();
  const url = "/api/admin/receipts?limit=25" + (q?("&q="+encodeURIComponent(q)):"");
  const out = await api(url);
  log(out);
  const sel = $("receiptPick"); sel.innerHTML = "<option value=''>("+ (out.ok? out.receipts.length : "0") +" loaded)</option>";
  if(out.ok){
    for(const r of out.receipts){
      const d = r.purchase_date ? new Date(r.purchase_date).toISOString().slice(0,10) : "—";
      const amt = typeof r.total_cents === "number" ? "$" + (r.total_cents/100).toFixed(2) : "";
      const opt = document.createElement("option");
      opt.value = r.id;
      opt.textContent = \`\${d} • \${r.merchant ?? "unknown"} • \${amt} • \${r.order_id ?? ""}\`;
      sel.appendChild(opt);
    }
  }
  toast("Receipts loaded");
}); }

async function getLink(){ await withSpin("getLinkBtn", async ()=>{
  if(!rid()) return toast("Missing receipt id");
  const out = await api(\`/api/price/link?receipt_id=\${encodeURIComponent(rid())}\`);
  log(out); toast(out.ok ? "Link fetched" : "Error");
}); }

async function upsertLink(){ await withSpin("upsertBtn", async ()=>{
  if(!rid()) return toast("Missing receipt id");
  const u = $("url").value.trim();
  const h = $("hint").value.trim();
  if(!u) return toast("Missing product URL");
  const out = await api(\`/api/price/link?receipt_id=\${encodeURIComponent(rid())}&action=upsert&url=\${encodeURIComponent(u)}&merchant_hint=\${encodeURIComponent(h)}&active=1\`);
  log(out); toast(out.ok ? "Link upserted" : "Error");
}); }

async function preview(){ await withSpin("previewBtn", async ()=>{
  if(!rid()) return toast("Missing receipt id");
  const cur = $("cur").value.trim();
  const qs = cur ? \`&current_price=\${encodeURIComponent(cur)}\` : "";
  const res = await fetch(ORIGIN + \`/api/policy/preview?id=\${encodeURIComponent(rid())}\${qs}\`, { cache:"no-store", credentials:"same-origin" });
  const json = await res.json(); log(json);
  toast(json.ok ? "Preview ready" : "Error");
}); }

async function watchDry(){ await withSpin("dryBtn", async ()=>{
  if(!rid()) return toast("Missing receipt id");
  const m = $("mock").value.trim(); if(!m) return toast("Enter mock price in cents");
  const out = await api(\`/api/cron/price-watch?receipt_id=\${encodeURIComponent(rid())}&mock_price=\${encodeURIComponent(m)}&dry=1\`);
  log(out); toast(out.ok ? "Dry run ok" : "Error");
}); }

async function watchSend(){ await withSpin("sendBtn", async ()=>{
  if(!rid()) return toast("Missing receipt id");
  const m = $("mock").value.trim(); if(!m) return toast("Enter mock price in cents");
  const out = await api(\`/api/cron/price-watch?receipt_id=\${encodeURIComponent(rid())}&mock_price=\${encodeURIComponent(m)}\`);
  log(out); toast(out.ok ? (out.emailed? "Email sent" : "No email") : "Error");
}); }

async function listDecisions(){
  if(!rid()) return toast("Missing receipt id");
  const out = await api(\`/api/decisions?receipt_id=\${encodeURIComponent(rid())}&action=list\`);
  log(out); toast(out.ok ? "Listed" : "Error");
}
async function createDecision(kind){
  if(!rid()) return toast("Missing receipt id");
  const out = await api(\`/api/decisions?receipt_id=\${encodeURIComponent(rid())}&action=create&decision=\${encodeURIComponent(kind)}\`);
  log(out); toast(out.ok ? "Created" : "Error");
}
</script>
`);
}
