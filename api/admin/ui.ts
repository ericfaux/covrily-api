// @ts-nocheck
// api/admin/ui.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { runtime: "nodejs" } as const;

// Simple html util
const H = String.raw;

// Pull ADMIN_TOKEN into page at runtime (we don’t expose it in html; we read it from URL)
// UI expects you to open:  /api/admin/ui?token=YOUR_ADMIN_TOKEN
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.status(200).send(pageHtml());
}

function pageHtml() {
  return H`
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Covrily – Admin UI</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
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
  .muted{color:var(--muted)}
  .mono{font-family: ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace}
  .table{width:100%;border-collapse:collapse;margin-top:8px}
  .table td{padding:6px 8px;border-top:1px solid #1f2937}
  .right{text-align:right}
  pre{white-space:pre-wrap;background:#0b1220;border-radius:12px;padding:12px;overflow:auto;border:1px solid #1f2937}
  .pill{display:inline-block;border:1px solid #1f2937;border-radius:999px;padding:2px 8px;font-size:12px;color:var(--muted)}
</style>
</head>
<body>
  <div class="wrap">
    <h1>Covrily – Admin UI</h1>

    <!-- Auth -->
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

    <!-- Receipt & Link -->
    <div class="card">
      <h2>Receipt &amp; Link</h2>
      <div class="row">
        <label for="rid">Receipt ID</label>
        <input id="rid" type="text" placeholder="UUID of receipts.id"/>
      </div>
      <div class="row">
        <label for="purl">Product URL</label>
        <input id="purl" type="text" placeholder="https://example.com/product/123"/>
      </div>
      <div class="row">
        <label for="mhint">Merchant Hint</label>
        <input id="mhint" type="text" placeholder="Best Buy (optional)"/>
      </div>
      <div class="stack">
        <button class="btn" id="getLink">Get Link</button>
        <button class="btn" id="upsertLink">Upsert Link</button>
        <span class="muted">Uses /api/price/link</span>
      </div>
    </div>

    <!-- Receipt Snapshot (NEW) -->
    <div class="card">
      <h2>Receipt Snapshot <span class="pill" id="rsCurrency"></span></h2>
      <div class="stack" style="margin-bottom:8px">
        <button class="btn" id="loadReceipt">Load Receipt</button>
        <span class="muted">Shows currency, tax &amp; shipping from <code>/api/receipts</code>.</span>
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

    <!-- Policy Preview -->
    <div class="card">
      <h2>Policy Preview</h2>
      <div class="row">
        <label for="currPrice">Current Price ($)</label>
        <input id="currPrice" type="text" placeholder="e.g. 10.00 (optional)"/>
      </div>
      <div class="stack">
        <button class="btn" id="preview">Preview</button>
        <span class="muted">Uses /api/policy/preview</span>
      </div>
    </div>

    <!-- Price Watch -->
    <div class="card">
      <h2>Price Watch</h2>
      <div class="row">
        <label for="mockPrice">Mock Price (cents)</label>
        <input id="mockPrice" type="text" placeholder="e.g. 1000 = $10.00"/>
      </div>
      <div class="stack">
        <button class="btn" id="dryRun">Dry Run</button>
        <button class="btn primary" id="runSend">Run &amp; Send</button>
        <span class="muted">Uses /api/cron/price-watch</span>
      </div>
    </div>

    <!-- Output -->
    <div class="card">
      <h2>Output</h2>
      <div class="stack" style="justify-content:flex-end">
        <button class="btn" id="clear">Clear</button>
        <button class="btn" id="copy">Copy</button>
      </div>
      <pre id="out" class="mono" style="min-height:220px"></pre>
    </div>
  </div>

<script>
(function(){
  const $ = (id) => document.getElementById(id);
  const fmtMoney = (cents, cur='USD') => {
    if (cents == null || isNaN(cents)) return '—';
    const v = Number(cents)/100;
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur }).format(v); }
    catch { return (cur + ' ' + v.toFixed(2)); }
  };
  const tokenFromQS = new URLSearchParams(location.search).get('token') || '';
  const token = () => localStorage.getItem('covrily_admin_token') || tokenFromQS || $('token').value.trim();

  // wire inputs
  $('token').value = localStorage.getItem('covrily_admin_token') || tokenFromQS || '';

  $('saveToken').onclick = () => {
    const t = $('token').value.trim();
    if (!t) return alert('Enter a token first.');
    localStorage.setItem('covrily_admin_token', t);
    alert('Saved.');
  };
  $('clearToken').onclick = () => { localStorage.removeItem('covrily_admin_token'); $('token').value=''; alert('Cleared.'); };
  $('ping').onclick = async () => { print({ ok:true, ping:true, now: new Date().toISOString() }); };

  const rid = () => $('rid').value.trim();
  const base = () => location.origin;

  function print(obj){ $('out').textContent = JSON.stringify(obj, null, 2); }
  function append(obj){ const cur=$('out').textContent; $('out').textContent = (cur?cur+'\\n\\n':'') + JSON.stringify(obj, null, 2); }

  // Get/Upsert Link
  $('getLink').onclick = async () => {
    const url = base()+\`/api/price/link?receipt_id=\${encodeURIComponent(rid())}&token=\${encodeURIComponent(token())}\`;
    const r = await fetch(url); print(await r.json());
  };
  $('upsertLink').onclick = async () => {
    const url = base()+\`/api/price/link?receipt_id=\${encodeURIComponent(rid())}&action=upsert&url=\${encodeURIComponent($('purl').value)}&merchant_hint=\${encodeURIComponent($('mhint').value)}&active=1&token=\${encodeURIComponent(token())}\`;
    const r = await fetch(url); print(await r.json());
  };

  // NEW: Load Receipt Snapshot
  $('loadReceipt').onclick = async () => {
    const r = await fetch(base()+\`/api/receipts?id=\${encodeURIComponent(rid())}&token=\${encodeURIComponent(token())}\`);
    const j = await r.json();
    print(j);
    if (!j.ok || !j.receipt){ $('rsTable').style.display='none'; return; }
    const rc = j.receipt;
    const cur = rc.currency || 'USD';
    const tax = Number(rc.tax_cents ?? 0);
    const ship = Number(rc.shipping_cents ?? 0);
    const total = Number(rc.total_cents ?? 0);
    const sub = Math.max(0, total - tax - ship);

    $('rsCurrency').textContent = cur;
    $('rsMerchant').textContent = rc.merchant || '—';
    $('rsOrder').textContent = rc.order_id || '—';
    $('rsDate').textContent = rc.purchase_date || '—';
    $('rsSubtotal').textContent = fmtMoney(sub, cur);
    $('rsTax').textContent = fmtMoney(tax, cur);
    $('rsShipping').textContent = fmtMoney(ship, cur);
    $('rsTotal').textContent = fmtMoney(total, cur);
    $('rsTable').style.display = '';
  };

  // Policy Preview
  $('preview').onclick = async () => {
    const qp = new URLSearchParams({ id: rid(), token: token() });
    const v = $('currPrice').value.trim();
    if (v) qp.set('current_price', v);
    const r = await fetch(base()+\`/api/policy/preview?\${qp}\`);
    print(await r.json());
  };

  // Price watch
  $('dryRun').onclick = async () => {
    const qp = new URLSearchParams({ receipt_id: rid(), dry: '1' });
    const mp = $('mockPrice').value.trim(); if (mp) qp.set('mock_price', mp);
    const r = await fetch(base()+\`/api/cron/price-watch?\${qp}\`);
    print(await r.json());
  };
  $('runSend').onclick = async () => {
    const qp = new URLSearchParams({ receipt_id: rid() });
    const mp = $('mockPrice').value.trim(); if (mp) qp.set('mock_price', mp);
    const r = await fetch(base()+\`/api/cron/price-watch?\${qp}\`);
    print(await r.json());
  };

  // Output utils
  $('clear').onclick = () => { $('out').textContent = ''; };
  $('copy').onclick = async () => {
    await navigator.clipboard.writeText($('out').textContent || '');
    alert('Copied to clipboard');
  };
})();
</script>

</body>
</html>`;
}
