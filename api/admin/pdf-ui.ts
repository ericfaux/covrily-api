// api/admin/pdf-ui.ts
import type { VercelRequest, VercelResponse } from "vercel";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const tokenQ = (req.query.token as string) || "";

  res.setHeader("content-type", "text/html; charset=utf-8");
  return res.status(200).send(`<!doctype html>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Covrily – PDF Ingest</title>
<style>
:root{--bg:#0b1220;--card:#0e1629;--text:#e6edf3;--muted:#99a3b3;--border:#1f2a44;--accent:#5b9dff}
body{font-family:ui-sans-serif,system-ui,Segoe UI,Roboto,Helvetica,Arial;background:var(--bg);color:var(--text);margin:0}
.wrap{max-width:860px;margin:26px auto;padding:0 16px}
.card{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:16px;margin:16px 0}
.row{display:grid;grid-template-columns:160px 1fr;gap:12px;align-items:center;margin:10px 0}
input,button{font:inherit} input{width:100%;padding:10px;border:1px solid var(--border);border-radius:10px;background:transparent;color:var(--text)}
.btn{padding:8px 12px;border:1px solid var(--border);border-radius:10px;background:var(--accent);color:#fff;cursor:pointer}
.btn.ghost{background:transparent;color:var(--text)}
pre{background:#0b1220;border-radius:12px;padding:12px;max-height:380px;overflow:auto}
small{color:var(--muted)}
</style>
<div class="wrap">
  <div class="card">
    <h2>Auth</h2>
    <div class="row"><label>Admin Token</label><input id="token" placeholder="x-admin-token"></div>
    <button class="btn" onclick="saveToken()">Save token</button>
    <small>Pass ?token=... once and it will be remembered.</small>
  </div>

  <div class="card">
    <h2>PDF Ingest (H&amp;M)</h2>
    <div class="row"><label>PDF URL</label><input id="url" placeholder="https://.../your-hm-receipt.pdf"></div>
    <div class="row"><label>User ID (optional)</label><input id="uid" placeholder="profiles.id (optional)"></div>
    <div>
      <button class="btn" onclick="preview()">Parse only</button>
      <button class="btn ghost" onclick="save()">Parse & Save</button>
    </div>
    <div style="margin-top:10px"><small>Tip: Upload the PDF to Supabase Storage (public bucket) and paste the public/signed URL here.</small></div>
  </div>

  <div class="card">
    <h2>Output</h2>
    <pre id="out">Ready.</pre>
  </div>
</div>

<script>
const $ = (id)=>document.getElementById(id);
const ORIGIN = location.origin;

(function init(){
  const url = new URL(location.href);
  const tq = url.searchParams.get("token") || "${tokenQ}";
  if(tq) localStorage.setItem("covrily_admin_token", tq);
  $("token").value = localStorage.getItem("covrily_admin_token") || "";
})();

function saveToken(){ localStorage.setItem("covrily_admin_token", $("token").value.trim()); log("Saved."); }
function tok(){ return $("token").value || localStorage.getItem("covrily_admin_token") || ""; }
function log(obj){ $("out").textContent = typeof obj==='string'?obj:JSON.stringify(obj,null,2); }

async function call(path){
  const t = tok(); if(!t) return log("Set the token first.");
  const r = await fetch(ORIGIN+path, { headers: { "x-admin-token": t } });
  const text = await r.text(); try{ return JSON.parse(text); }catch{ return { raw: text }; }
}

async function preview(){
  const u = $("url").value.trim(); if(!u) return log("Need PDF URL");
  const out = await call("/api/admin/ingest-pdf?url="+encodeURIComponent(u));
  log(out);
}

async function save(){
  const u = $("url").value.trim(); if(!u) return log("Need PDF URL");
  const uid = $("uid").value.trim();
  const qs = "/api/admin/ingest-pdf?save=1&url="+encodeURIComponent(u)+(uid?("&user_id="+encodeURIComponent(uid)):"");
  const out = await call(qs);
  log(out);
}
</script>`);
}
