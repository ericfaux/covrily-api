// api/admin/ui.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Covrily – Admin UI</title>
<style>
  :root { --bg:#0b1622; --panel:#0f1e2d; --muted:#6b87a5; --fg:#e9f0f7; --accent:#5ea3ff; --ok:#23c55e; --warn:#f59e0b; --danger:#ef4444; --line:#1e2b3a; }
  html,body{margin:0;padding:0;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;}
  .wrap{max-width:980px;margin:28px auto;padding:0 16px;}
  h1{font-size:20px;margin:0 0 12px 0}
  section{background:var(--panel);border:1px solid var(--line);border-radius:10px;margin:16px 0;padding:14px 16px;}
  section h2{font-size:14px;margin:0 0 8px 0;color:#cfe0f5}
  .row{display:flex;gap:10px;align-items:center;margin:8px 0}
  .col{display:flex;flex-direction:column;gap:6px;flex:1}
  label{font-size:12px;color:var(--muted)}
  input[type=text],select,textarea{width:100%;box-sizing:border-box;background:#0b1a29;border:1px solid var(--line);border-radius:8px;color:var(--fg);padding:10px 12px;outline:none}
  input[type=text]:focus,select:focus,textarea:focus{border-color:#2c64a1}
  button{background:#173655;border:1px solid #224b74;color:#e8f1fa;border-radius:8px;padding:9px 12px;cursor:pointer}
  button:hover{background:#214766}
  .btn-ok{background:#1a5f3a;border-color:#22774a}
  .btn-warn{background:#6b4e0b;border-color:#9a6d0f}
  .btn-danger{background:#7a2121;border-color:#a12b2b}
  small.note{color:var(--muted)}
  pre{white-space:pre-wrap;background:#0a1521;border:1px solid var(--line);border-radius:10px;margin:8px 0 0 0;padding:10px 12px;max-height:380px;overflow:auto}
  .inline{display:inline-flex;gap:8px;align-items:center}
</style>
</head>
<body>
<div class="wrap">
  <h1>Covrily – Admin UI</h1>

  <!-- Auth -->
  <section>
    <h2>Auth</h2>
    <div class="row">
      <div class="col">
        <label>Admin Token</label>
        <input id="tok" type="text" placeholder="ADMIN_TOKEN" />
        <small class="note">Token is stored in localStorage on this device only.</small>
      </div>
      <div class="inline">
        <button id="saveTok">Save token</button>
        <button id="clearTok">Clear</button>
        <button id="ping">Ping</button>
      </div>
    </div>
  </section>

  <!-- Recent Receipts -->
  <section>
    <h2>Recent Receipts</h2>
    <div class="row">
      <div class="col">
        <label>Search (optional)</label>
        <input id="srch" type="text" placeholder="merchant or order #" />
      </div>
      <div class="inline">
        <button id="loadRecent">Load</button>
        <button id="copyId">Copy Receipt ID</button>
      </div>
    </div>
    <div class="row">
      <div class="col">
        <label>Pick one</label>
        <select id="pickOne"></select>
      </div>
    </div>
    <small class="note">Loads the latest receipts (search filters by merchant/order id).</small>
  </section>

  <!-- Receipt & Link -->
  <section>
    <h2>Receipt & Link</h2>
    <div class="row">
      <div class="col">
        <label>Receipt ID</label>
        <input id="rid" type="text" placeholder="UUID of receipts.id" />
      </div>
      <div class="col">
        <label>Product URL</label>
        <input id="purl" type="text" placeholder="https://example.com/product/123" />
      </div>
    </div>
    <div class="row">
      <div class="col">
        <label>Merchant Hint</label>
        <input id="mhint" type="text" placeholder="Best Buy (optional)" />
      </div>
      <div class="inline">
        <button id="getLink">Get Link</button>
        <button id="upsertLink">Upsert Link</button>
        <button id="loadReceipt">Load Receipt</button>
      </div>
    </div>
    <small class="note">Shows currency, tax & shipping from /api/receipts.</small>
  </section>

  <!-- Policy Preview -->
  <section>
    <h2>Policy Preview</h2>
    <div class="row">
      <div class="col">
        <label>Current Price ($)</label>
        <input id="curPrice" type="text" placeholder="e.g. 10.00 (optional)" />
      </div>
      <div class="inline">
        <button id="preview">Preview</button>
        <small class="note">Uses /api/policy/preview</small>
      </div>
    </div>
  </section>

  <!-- Price Watch -->
  <section>
    <h2>Price Watch</h2>
    <div class="row">
      <div class="col">
        <label>Mock Price (cents)</label>
        <input id="mockCents" type="text" placeholder="e.g. 1000 = $10.00" />
      </div>
      <div class="inline">
        <button id="dryRun">Dry Run</button>
        <button id="runSend">Run &amp; Send</button>
        <small class="note">Uses /api/cron/price-watch</small>
      </div>
    </div>
  </section>

  <!-- Output -->
  <section>
    <div class="inline">
      <button id="outClear">Clear</button>
      <button id="outCopy">Copy</button>
    </div>
    <pre id="out"></pre>
  </section>
</div>

<script>
(function(){
  const $ = (id)=>document.getElementById(id);
  const tokInp = $('tok');
  const out = $('out');

  function token(){ return tokInp.value.trim(); }
  function saveToken(){ localStorage.setItem('admin.token', token()); }
  function loadToken(){ tokInp.value = localStorage.getItem('admin.token') || ''; }
  function clearToken(){ tokInp.value=''; saveToken(); }

  function log(obj){
    const txt = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
    out.textContent = (out.textContent ? out.textContent + "\\n" : "") + txt + "\\n";
    out.scrollTop = out.scrollHeight;
  }
  function clearOut(){ out.textContent=''; }
  function copyOut(){ navigator.clipboard.writeText(out.textContent || ''); }

  async function call(url, opts={}){
    const headers = Object.assign({'x-admin-token': token()}, opts.headers||{});
    const res = await fetch(url, Object.assign({}, opts, { headers }));
    let bodyText = '';
    try { bodyText = await res.text(); } catch {}
    let body = null;
    try { body = JSON.parse(bodyText); } catch { body = bodyText; }
    const row = { url, status: res.status, body, bodyText };
    log(row);
    return row;
  }

  // ---- controls ----
  $('saveTok').onclick = ()=>{ saveToken(); log('Token saved.'); };
  $('clearTok').onclick = ()=>{ clearToken(); log('Token cleared.'); };
  $('ping').onclick = async ()=>{
    await call('/api/diag/env?token='+encodeURIComponent(token()));
    await call('/api/health?token='+encodeURIComponent(token()));
  };

  // Recent: load & pick
  $('loadRecent').onclick = async ()=>{
    const q = $('srch').value.trim();
    const url = '/api/admin/recent?q='+encodeURIComponent(q)+'&limit=12&token='+encodeURIComponent(token());
    const r = await call(url);
    const items = (r.body && r.body.items) || [];
    const sel = $('pickOne');
    sel.innerHTML = '';
    const opt0 = document.createElement('option');
    opt0.value = ''; opt0.textContent = '(empty)';
    sel.appendChild(opt0);
    for (const it of items){
      const label = \`\${it.merchant} — \${it.order_id || 'EMPTY'} — $\${((it.total_cents||0)/100).toFixed(2)} — \${it.purchase_date || ''}\`;
      const o = document.createElement('option');
      o.value = it.id;
      o.textContent = label;
      o.dataset.url = it?.link?.url || '';
      o.dataset.mhint = it?.link?.merchant_hint || '';
      sel.appendChild(o);
    }
  };

  $('pickOne').onchange = ()=>{
    const sel = $('pickOne');
    const rid = sel.value;
    if (!rid) return;
    $('rid').value = rid;
    // If we have a saved link, prefill
    const opt = sel.options[sel.selectedIndex];
    const url = opt?.dataset?.url || '';
    const mh  = opt?.dataset?.mhint || '';
    if (url) $('purl').value = url;
    if (mh)  $('mhint').value = mh;
  };

  $('copyId').onclick = ()=>{
    const rid = $('rid').value.trim();
    if (!rid) return;
    navigator.clipboard.writeText(rid);
    log('Receipt ID copied to clipboard.');
  };

  // Link helpers
  $('getLink').onclick = async ()=>{
    const rid = $('rid').value.trim();
    if (!rid) return log('Set Receipt ID first.');
    await call('/api/price/link?receipt_id='+encodeURIComponent(rid)+'&token='+encodeURIComponent(token()));
  };

  $('upsertLink').onclick = async ()=>{
    const rid = $('rid').value.trim();
    let url = $('purl').value.trim();
    const hint = $('mhint').value.trim();

    if (!rid) return log('Set Receipt ID first.');
    if (!url) return log({ ok:false, error:'Product URL required for Upsert Link' });

    // normalize
    if (!/^https?:\\/\\//i.test(url)) url = 'https://'+url;

    const qs = new URLSearchParams({
      receipt_id: rid,
      action: 'upsert',
      url,
      merchant_hint: hint,
      active: '1',
      token: token()
    });
    await call('/api/price/link?'+qs.toString());
  };

  // Load receipt snapshot
  $('loadReceipt').onclick = async ()=>{
    const rid = $('rid').value.trim();
    if (!rid) return log('Set Receipt ID first.');
    await call('/api/receipts?id='+encodeURIComponent(rid)+'&token='+encodeURIComponent(token()));
  };

  // Policy preview
  $('preview').onclick = async ()=>{
    const rid = $('rid').value.trim();
    if (!rid) return log('Set Receipt ID first.');
    const cp = $('curPrice').value.trim();
    const qs = new URLSearchParams({ id: rid });
    if (cp) qs.set('current_price', cp);
    qs.set('token', token());
    await call('/api/policy/preview?'+qs.toString());
  };

  // Price watch
  $('dryRun').onclick = async ()=>{
    const rid = $('rid').value.trim();
    const cents = $('mockCents').value.trim();
    if (!rid) return log('Set Receipt ID first.');
    const qs = new URLSearchParams({
      receipt_id: rid,
      mock_price: cents || '',
      dry: '1'
    });
    await call('/api/cron/price-watch?'+qs.toString());
  };

  $('runSend').onclick = async ()=>{
    const rid = $('rid').value.trim();
    const cents = $('mockCents').value.trim();
    if (!rid) return log('Set Receipt ID first.');
    const qs = new URLSearchParams({
      receipt_id: rid,
      mock_price: cents || ''
    });
    await call('/api/cron/price-watch?'+qs.toString());
  };

  // Output helpers
  $('outClear').onclick = clearOut;
  $('outCopy').onclick = copyOut;

  // bootstrap
  loadToken();
})();
</script>
</body>
</html>`);
}
