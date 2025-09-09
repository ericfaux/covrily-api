// /api/admin/ui.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.status(200).send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Covrily – Admin UI</title>
<style>
  :root { --bg:#0b1220; --panel:#121a2a; --muted:#8aa0b8; --fg:#eaf2ff; --accent:#2ea0ff; --btn:#1b2942; --btnhi:#274069; --ok:#21c17a; --bad:#ff6577; }
  *{box-sizing:border-box} html,body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial}
  .wrap{max-width:940px;margin:24px auto;padding:0 16px}
  h1{font-size:18px;margin:0 0 16px 0}
  .card{background:var(--panel);border-radius:8px;padding:16px;margin:16px 0;border:1px solid #1f2b40}
  .row{display:flex;gap:12px;align-items:center;margin:10px 0}
  .col{flex:1}
  label{display:block;margin:6px 0 4px;color:var(--muted)}
  input,select{width:100%;padding:10px 12px;border-radius:6px;border:1px solid #2a3a57;background:#0e1729;color:var(--fg)}
  input::placeholder{color:#6d86a2}
  button{background:var(--btn);color:var(--fg);border:1px solid #2a3a57;padding:9px 12px;border-radius:6px;cursor:pointer}
  button:hover{background:var(--btnhi)}
  .btn-accent{background:var(--accent);border-color:var(--accent);color:#001425}
  .btn-outline{background:transparent}
  .note{color:var(--muted);font-size:12px;margin-top:4px}
  .out{white-space:pre-wrap;background:#0e1729;border:1px solid #2a3a57;border-radius:8px;padding:12px;min-height:180px;overflow:auto}
  .section-title{font-weight:600;margin:0 0 8px 0}
  .pill{display:inline-block;padding:3px 8px;border-radius:999px;background:#12233a;color:var(--muted);font-size:12px;margin-left:6px}
</style>
</head>
<body>
<div class="wrap">
  <h1>Covrily – Admin UI</h1>

  <!-- Auth -->
  <div class="card">
    <div class="section-title">Auth</div>
    <div class="row">
      <div class="col">
        <label>Admin Token</label>
        <input id="adminToken" placeholder="ADMIN_TOKEN" />
        <div class="note">Token is stored in localStorage on this device only.</div>
      </div>
      <div class="col" style="flex:0">
        <label>&nbsp;</label>
        <div class="row">
          <button id="saveToken" class="btn-accent">Save token</button>
          <button id="clearToken" class="btn-outline">Clear</button>
          <button id="ping">Ping</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Recent Receipts -->
  <div class="card">
    <div class="section-title">Recent Receipts <span class="pill" id="rCount">(empty)</span></div>
    <div class="row">
      <div class="col">
        <label>Search (optional)</label>
        <input id="rSearch" placeholder="merchant or order #"/>
      </div>
      <button id="rLoad">Load</button>
      <button id="rCopy">Copy Receipt ID</button>
    </div>
    <div class="row">
      <div class="col">
        <label>Pick one</label>
        <select id="rPick"></select>
        <div class="note">Loads the latest receipts (search filters by merchant/order id).</div>
      </div>
    </div>
  </div>

  <!-- Receipt & Link -->
  <div class="card">
    <div class="section-title">Receipt & Link</div>
    <div class="row">
      <div class="col">
        <label>Receipt ID</label>
        <input id="rid" placeholder="UUID of receipts.id"/>
      </div>
      <div class="col">
        <label>Product URL</label>
        <input id="prodUrl" placeholder="https://example.com/product/123"/>
      </div>
    </div>
    <div class="row">
      <div class="col">
        <label>Merchant Hint</label>
        <input id="merchantHint" placeholder="Best Buy (optional)"/>
      </div>
      <div class="col" style="flex:0">
        <label>&nbsp;</label>
        <div class="row">
          <button id="getLink">Get Link</button>
          <button id="upsertLink">Upsert Link</button>
        </div>
      </div>
    </div>
    <div class="row">
      <button id="loadReceipt">Load Receipt</button>
      <div class="note">Shows currency, tax & shipping from /api/receipts.</div>
    </div>
  </div>

  <!-- Policy Preview -->
  <div class="card">
    <div class="section-title">Policy Preview</div>
    <div class="row">
      <div class="col">
        <label>Current Price ($)</label>
        <input id="currentPrice" placeholder="e.g. 10.00 (optional)"/>
      </div>
      <button id="preview">Preview</button>
      <div class="note">Uses /api/policy/preview</div>
    </div>
  </div>

  <!-- Price Watch -->
  <div class="card">
    <div class="section-title">Price Watch</div>
    <div class="row">
      <div class="col">
        <label>Mock Price (cents)</label>
        <input id="mockPrice" placeholder="e.g. 1000 = $10.00"/>
      </div>
      <button id="dryRun">Dry Run</button>
      <button id="runSend">Run &amp; Send</button>
      <div class="note">Uses /api/cron/price-watch</div>
    </div>
  </div>

  <!-- Output -->
  <div class="card">
    <div class="row">
      <div class="col"><div class="section-title">Output</div></div>
      <div class="col" style="text-align:right">
        <button id="outClear" class="btn-outline">Clear</button>
        <button id="outCopy">Copy</button>
      </div>
    </div>
    <div id="out" class="out"></div>
  </div>
</div>

<script>
(function(){
  const qs = (s)=>document.querySelector(s);
  const out = qs('#out');
  const tokenInput = qs('#adminToken');

  // ——— helpers ———
  function print(obj) {
    const txt = (typeof obj === 'string') ? obj : JSON.stringify(obj, null, 2);
    out.textContent += (out.textContent ? "\\n" : "") + txt;
    out.scrollTop = out.scrollHeight;
  }
  function clearOut(){ out.textContent = ""; }
  async function fetchJSON(url, init = {}) {
    try {
      const resp = await fetch(url, init);
      const ct = resp.headers.get('content-type') || '';
      let body = '';
      if (ct.includes('application/json')) body = await resp.json();
      else body = await resp.text();
      return { url, status: resp.status, body };
    } catch (e) {
      return { url, status: 0, body: String(e) };
    }
  }

  // ——— token ———
  function saveTokenLocal(t) { localStorage.setItem('covrily.admin.token', t || ''); }
  function getTokenLocal() { return localStorage.getItem('covrily.admin.token') || ''; }
  function setTokenUI(t){ tokenInput.value = t || ''; }

  // ——— init ———
  setTokenUI(getTokenLocal());

  // ——— button wire-up ———
  qs('#saveToken').onclick = () => {
    saveTokenLocal(tokenInput.value.trim());
    clearOut(); print('Token saved.');
  };
  qs('#clearToken').onclick = () => {
    saveTokenLocal(''); setTokenUI(''); clearOut(); print('Token cleared.');
  };

  // Ping hits both endpoints; send header *and* ?token= fallback
  qs('#ping').onclick = async () => {
    clearOut();
    const t = tokenInput.value.trim();
    const hdrs = { 'x-admin-token': t };
    print(await fetchJSON('/api/diag/env?token='+encodeURIComponent(t), { headers: hdrs }));
    print(await fetchJSON('/api/health?token='+encodeURIComponent(t), { headers: hdrs }));
  };

  // ——— Recent Receipts ———
  const rSearch = qs('#rSearch');
  const rPick = qs('#rPick');
  const rCount = qs('#rCount');

  async function loadReceipts() {
    const q = rSearch.value.trim();
    const url = q ? '/api/receipts?search='+encodeURIComponent(q) : '/api/receipts';
    const r = await fetchJSON(url);
    print(r);
    try {
      const rows = r.body && r.body.receipts ? r.body.receipts : [];
      rPick.innerHTML = '';
      rows.forEach((row) => {
        const o = document.createElement('option');
        o.value = row.id;
        o.textContent = row.merchant + ' — ' + (row.order_id || 'EMPTY') + ' — ' + (row.purchase_date || 'NA');
        rPick.appendChild(o);
      });
      rCount.textContent = '(' + rows.length + ' loaded)';
      // when list loads, populate the receipt id input for convenience
      if (rows.length) qs('#rid').value = rows[0].id;
    } catch {}
  }
  qs('#rLoad').onclick = loadReceipts;
  qs('#rCopy').onclick = () => {
    const v = (rPick.value || '').trim();
    if (!v) return;
    navigator.clipboard.writeText(v);
    print('Copied receipt id: ' + v);
    qs('#rid').value = v;
  };

  // ——— Receipt & Link ———
  qs('#getLink').onclick = async () => {
    const rid = qs('#rid').value.trim();
    if (!rid) return print('Enter a receipt id.');
    print(await fetchJSON('/api/price/link?receipt_id='+encodeURIComponent(rid)));
  };
  qs('#upsertLink').onclick = async () => {
    const rid = qs('#rid').value.trim();
    const url = qs('#prodUrl').value.trim();
    const hint = qs('#merchantHint').value.trim();
    const u = '/api/price/link?receipt_id='+encodeURIComponent(rid)
              + '&action=upsert'
              + (url ? '&url='+encodeURIComponent(url) : '')
              + (hint ? '&merchant_hint='+encodeURIComponent(hint) : '');
    print(await fetchJSON(u));
  };
  qs('#loadReceipt').onclick = async () => {
    const rid = qs('#rid').value.trim();
    if (!rid) return print('Enter a receipt id.');
    print(await fetchJSON('/api/receipts?id='+encodeURIComponent(rid)));
  };

  // ——— Policy Preview ———
  qs('#preview').onclick = async () => {
    const rid = qs('#rid').value.trim();
    const price = qs('#currentPrice').value.trim();
    if (!rid) return print('Enter a receipt id.');
    const u = '/api/policy/preview?id='+encodeURIComponent(rid)
              + (price ? '&current_price='+encodeURIComponent(price) : '');
    print(await fetchJSON(u));
  };

  // ——— Price Watch ———
  qs('#dryRun').onclick = async () => {
    const rid = qs('#rid').value.trim();
    const mock = qs('#mockPrice').value.trim();
    if (!rid || !mock) return print('Enter receipt id and mock price (cents).');
    const u = '/api/cron/price-watch?receipt_id='+encodeURIComponent(rid)
              + '&mock_price='+encodeURIComponent(mock)
              + '&dry=1';
    print(await fetchJSON(u));
  };
  qs('#runSend').onclick = async () => {
    const rid = qs('#rid').value.trim();
    const mock = qs('#mockPrice').value.trim();
    if (!rid || !mock) return print('Enter receipt id and mock price (cents).');
    const u = '/api/cron/price-watch?receipt_id='+encodeURIComponent(rid)
              + '&mock_price='+encodeURIComponent(mock);
    print(await fetchJSON(u));
  };

  // ——— output helpers ———
  qs('#outClear').onclick = clearOut;
  qs('#outCopy').onclick = () => navigator.clipboard.writeText(out.textContent || '');
})();
</script>
</body>
</html>`);
}
