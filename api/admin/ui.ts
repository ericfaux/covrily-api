// @ts-nocheck
// api/admin/ui.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { runtime: "nodejs" } as const;

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.status(200).send(html());
}

function html() {
  const H = String.raw;
  return H`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Covrily – Admin UI</title>
<style>
  :root { --bg:#0f172a; --panel:#111827; --muted:#94a3b8; --text:#e5e7eb; --brand:#22d3ee; }
  *{box-sizing:border-box} html,body{margin:0;padding:0;background:var(--bg);color:var(--text);font:14px/1.4 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial}
  a{color:var(--brand)} .wrap{max-width:980px;margin:28px auto;padding:0 16px}
  h1{font-size:22px;margin:0 0 16px} h2{font-size:16px;margin:0 0 12px}
  .card{background:var(--panel);border-radius:14px;padding:16px;margin:16px 0;box-shadow:0 0 0 1px rgba(255,255,255,.03)}
  .row{display:grid;grid-template-columns:180px 1fr;gap:12px;align-items:center;margin:10px 0}
  .row > label{color:var(--muted)}
  input,button,textarea{font:inherit}
  input[type=text]{width:100%;padding:10px 12px;border-radius:10px;border:1px solid #1f2937;background:#0b1220;color:var(--text)}
  .btn{background:#111827;border:1px solid #1f2937;color:#e5e7eb;padding:8px 12px;border-radius:10px;cursor:pointer}
  .btn:hover{border-color:#334155}
  .btn.primary{background:#0ea5e9;border-color:#0284c7}
  .stack{display:flex;gap:8px;flex-wrap:wrap}
  .muted{color:var(--muted)} .mono{font-family: ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace}
  .table{width:100%;border-collapse:collapse;margin-top:8px}
  .table td{padding:6px 8px;border-top:1px solid #1f2937}
  .right{text-align:right}
  pre{white-space:pre-wrap;background:#0b1220;border-radius:12px;padding:12px;overflow:auto;border:1px solid #1f2937;min-height:220px}
  .pill{display:inline-block;border:1px solid #1f2937;border-radius:999px;padding:2px 8px;font-size:12px;color:var(--muted)}
</style>
</head>
<body>
  <div class="wrap">
    <h1>Covrily – Admin UI</h1>

    <div class="card">
      <h2>Auth</h2>
      <div class="row">
        <label for="token">Admin Token</label>
        <input id="token" type="text" placeholder="ADMIN_TOKEN"/>
      </div>
      <div class="stack">
        <button class="btn" id="saveToken">Save token</button>
        <button class="btn" id="clearToken">Clear</button>
        <button class="btn" id="ping">Ping</button>
        <span class="muted">Tip: token is stored in localStorage on this device only.</span>
      </div>
    </div>

    <div class="card">
      <h2>Receipt &amp; Link</h2>
      <div class="row"><label for="rid">Receipt ID</label><input id="rid" type="text" placeholder="UUID of receipts.id"/></div>
      <div class="row"><label for="purl">Product URL</label><input id="purl" type="text" placeholder="https://example.com/product/123"/></div>
      <div class="row"><label for="mhint">Merchant Hint</label><input id="mhint" type="text" placeholder="Best Buy (optional)"/></div>
      <div class="stack">
        <button class="btn" id="getLink">Get Link</button>
        <button class="btn" id="upsertLink">Upsert Link</button>
        <span class="muted">Uses /api/price/link</span>
      </div>
    </div>

    <div class="card">
      <h2>Receipt Snapshot <span class="pill" id="rsCurrency"></span></h2>
      <div class="stack" style="margin-bottom:8px">
        <button class="btn" id="loadReceipt">Load Receipt</button>
        <span class="muted">Shows currency, tax &amp; shipping from /api/receipts.</span>
      </div>
      <table class="table mono" id="rsTable" style="display:none">
        <tbody>
          <tr><td>Merchant</td><td class="right" id="rsMerchant">—</td></tr>
          <tr><td>Order ID</td><td class="right" id="rsOrder">—</td></tr>
          <tr><td>Purchase Date</td><td class="right" id="rsDate">—</td></tr>
          <tr><td>Subtotal (calc)</td><td class="right" id="rsSubtotal">—</td></tr>
          <tr><td>Tax</td><td class="right" id="rsTax">—</td></tr>
          <tr><td>Shipping</td><td class="right" id="rsShipping">—</td></tr>
          <tr><td><strong>Total</strong></td><td class="right" id="rsTotal"><strong>—</strong></td></tr>
        </tbody>
      </table>
    </div>

    <div class="card">
      <h2>Policy Preview</h2>
      <div class="row"><label for="currPrice">Current Price ($)</label><input id="currPrice" type="text" placeholder="e.g. 10.00 (optional)"/></div>
      <div class="stack"><button class="btn" id="preview">Preview</button><span class="muted">Uses /api/policy/preview</span></div>
    </div>

    <div class="card">
      <h2>Price Watch</h2>
      <div class="row"><label for="mockPrice">Mock Price (cents)</label><input id="mockPrice" type="text" placeholder="e.g. 1000 = $10.00"/></div>
      <div class="stack">
        <button class="btn" id="dryRun">Dry Run</button>
        <button class="btn primary" id="runSend">Run &amp; Send</button>
        <span class="muted">Uses /api/cron/price-watch</span>
      </div>
    </div>

    <div class="card">
      <h2>Output</h2>
      <div class="stack" style="justify-content:flex-end">
        <button class="btn" id="clear">Clear</button>
        <button class="btn" id="copy">Copy</button>
      </div>
      <pre id="out" class="mono"></pre>
    </div>
  </div>

<script>
(function(){
  const $ = (id) => document.getElementById(id);
  const rawTokenQS = new URLSearchParams(location.search).get('token') || '';
  $('token').value = localStorage.getItem('covrily_admin_token') || rawTokenQS || '';

  const token = () => localStorage.getItem('covrily_admin_token') || rawTokenQS || $('token').value.trim();
  const rid   = () => $('rid').value.trim();
  const base  = () => location.origin;

  const print = (obj) => { $('out').textContent = (typeof obj === 'string') ? obj : JSON.stringify(obj, null, 2); };
  const append = (obj) => { const cur = $('out').textContent; $('out').textContent = (cur?cur+'\\n\\n':'') + ((typeof obj==='string')?obj:JSON.stringify(obj,null,2)); };

  // Universal fetch -> always prints something useful
  async function call(url) {
    try {
      const r = await fetch(url);
      const ct = r.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        const j = await r.json();
        append({ url, status:r.status, data:j });
        return j;
      } else {
        const t = await r.text();
        append({ url, status:r.status, text:t });
        return { ok:false, text:t, status:r.status };
      }
    } catch (e) {
      append({ url, error: String(e && e.message || e) });
      throw e;
    }
  }

  // Global error sinks -> visible in Output
  window.onerror = (m, s, l, c, e) => append({ onerror: String(m), stack: (e && e.stack)||null });
  window.onunhandledrejection = (ev) => append({ unhandled: String(ev && ev.reason || ev) });

  // Auth buttons
  $('saveToken').onclick = () => { const t = $('token').value.trim(); if(!t) return alert('Enter a token'); localStorage.setItem('covrily_admin_token', t); append({ savedToken:true }); };
  $('clearToken').onclick = () => { localStorage.removeItem('covrily_admin_token'); $('token').value=''; append({ clearedToken:true }); };
  $('ping').onclick = () => print({ ok:true, ping:true, now:new Date().toISOString() });

  // Link helpers
  $('getLink').onclick = async () => {
    const url = base()+\`/api/price/link?receipt_id=\${encodeURIComponent(rid())}&token=\${encodeURIComponent(token())}\`;
    await call(url);
  };
  $('upsertLink').onclick = async () => {
    const url = base()+\`/api/price/link?receipt_id=\${encodeURIComponent(rid())}&action=upsert&url=\${encodeURIComponent($('purl').value)}&merchant_hint=\${encodeURIComponent($('mhint').value)}&active=1&token=\${encodeURIComponent(token())}\`;
    await call(url);
  };

  // Receipt snapshot
  const money = (cents, cur='USD') => (cents==null||isNaN(cents))?'—':new Intl.NumberFormat(undefined,{style:'currency',currency:cur}).format(Number(cents)/100);
  $('loadReceipt').onclick = async () => {
    const j = await call(base()+\`/api/receipts?id=\${encodeURIComponent(rid())}&token=\${encodeURIComponent(token())}\`);
    if (!j || !j.ok || !j.receipt) { $('rsTable').style.display='none'; return; }
    const rc = j.receipt; const cur = rc.currency || 'USD';
    const tax = Number(rc.tax_cents ?? 0), ship = Number(rc.shipping_cents ?? 0), total = Number(rc.total_cents ?? 0);
    const sub = Math.max(0, total - tax - ship);
    $('rsCurrency').textContent = cur;
    $('rsMerchant').textContent = rc.merchant || '—';
    $('rsOrder').textContent = rc.order_id || '—';
    $('rsDate').textContent = rc.purchase_date || '—';
    $('rsSubtotal').textContent = money(sub, cur);
    $('rsTax').textContent = money(tax, cur);
    $('rsShipping').textContent = money(ship, cur);
    $('rsTotal').textContent = money(total, cur);
    $('rsTable').style.display = '';
  };

  // Policy preview
  $('preview').onclick = async () => {
    const qp = new URLSearchParams({ id: rid(), token: token() });
    const v = $('currPrice').value.trim(); if (v) qp.set('current_price', v);
    await call(base()+\`/api/policy/preview?\${qp}\`);
  };

  // Price watch
  $('dryRun').onclick = async () => {
    const qp = new URLSearchParams({ receipt_id: rid(), dry:'1' });
    const mp = $('mockPrice').value.trim(); if (mp) qp.set('mock_price', mp);
    await call(base()+\`/api/cron/price-watch?\${qp}\`);
  };
  $('runSend').onclick = async () => {
    const qp = new URLSearchParams({ receipt_id: rid() });
    const mp = $('mockPrice').value.trim(); if (mp) qp.set('mock_price', mp);
    await call(base()+\`/api/cron/price-watch?\${qp}\`);
  };

  // Output utils
  $('clear').onclick = () => { $('out').textContent=''; };
  $('copy').onclick = async () => { await navigator.clipboard.writeText($('out').textContent||''); alert('Copied'); };
})();
</script>
</body>
</html>`;
}
