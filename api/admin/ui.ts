// /api/admin/ui.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { runtime: "nodejs" };

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Covrily – Admin UI</title>
<style>
  :root { --bg:#0b1320; --panel:#121a2b; --border:#1d2942; --text:#e8efff; --muted:#9fb2d0; --btn:#1f2a44; --btn-hover:#2a3b63; }
  * { box-sizing: border-box; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji","Segoe UI Emoji"; }
  body { margin:0; background:var(--bg); color:var(--text); }
  .wrap { max-width: 980px; margin: 28px auto; padding: 0 16px; }
  h1 { font-size: 20px; margin: 0 0 16px 0; }
  .card { background: var(--panel); border:1px solid var(--border); border-radius: 12px; padding:16px; margin:16px 0; }
  .section-title { font-weight: 600; color:#cfe0ff; margin-bottom: 8px; }
  .row { display:grid; grid-template-columns: 160px 1fr; gap: 12px; align-items:center; margin:10px 0; }
  label { color: var(--muted); font-size:12px; }
  input[type=text], select { width:100%; padding:10px 12px; color:var(--text); background:#0e1830; border:1px solid var(--border); border-radius:10px; }
  .btn { display:inline-flex; gap:6px; align-items:center; background:var(--btn); color:var(--text); border:1px solid var(--border); padding:8px 12px; border-radius:10px; cursor:pointer; }
  .btn:hover { background: var(--btn-hover); }
  .btn-row { display:flex; gap:8px; flex-wrap:wrap; }
  .hint { color:var(--muted); font-size:12px; }
  pre { background:#0a1020; color:#e9f1ff; border:1px solid var(--border); border-radius:12px; padding:12px; min-height:160px; overflow:auto; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Covrily – Admin UI</h1>

  <!-- Auth -->
  <div class="card">
    <div class="section-title">Auth</div>
    <div class="row">
      <label for="token">Admin Token</label>
      <input id="token" type="text" placeholder="ETETOPOP159"/>
    </div>
    <div class="btn-row">
      <button id="saveToken" class="btn">Save token</button>
      <button id="clearToken" class="btn">Clear</button>
      <button id="ping" class="btn">Ping</button>
    </div>
    <div class="hint">Token is stored in localStorage on this device only.</div>
  </div>

  <!-- Recent Receipts -->
  <div class="card">
    <div class="section-title">Recent Receipts</div>
    <div class="row">
      <label for="search">Search (optional)</label>
      <input id="search" type="text" placeholder="merchant or order #"/>
    </div>
    <div class="row">
      <label for="recent">Pick one</label>
      <select id="recent">
        <option value="">(empty)</option>
      </select>
    </div>
    <div class="btn-row">
      <button id="loadRecent" class="btn">Load</button>
      <button id="copyRid" class="btn">Copy Receipt ID</button>
    </div>
    <div class="hint">Loads the latest receipts (search filters by merchant/order id).</div>
  </div>

  <!-- Receipt & Link -->
  <div class="card">
    <div class="section-title">Receipt &amp; Link</div>
    <div class="row">
      <label for="rid">Receipt ID</label>
      <input id="rid" type="text" placeholder="UUID of receipts.id"/>
    </div>
    <div class="row">
      <label for="url">Product URL</label>
      <input id="url" type="text" placeholder="https://example.com/product/123"/>
    </div>
    <div class="row">
      <label for="merchant">Merchant Hint</label>
      <input id="merchant" type="text" placeholder="Best Buy (optional)"/>
    </div>
    <div class="btn-row">
      <button id="getLink" class="btn">Get Link</button>
      <button id="upsertLink" class="btn">Upsert Link</button>
    </div>
    <div class="row" style="margin-top:8px">
      <label>Receipt Snapshot</label>
      <div class="btn-row">
        <button id="loadReceipt" class="btn">Load Receipt</button>
        <span class="hint">Shows currency, tax & shipping from <code>/api/receipts</code>.</span>
      </div>
    </div>
  </div>

  <!-- Policy Preview -->
  <div class="card">
    <div class="section-title">Policy Preview</div>
    <div class="row">
      <label for="currentPrice">Current Price ($)</label>
      <input id="currentPrice" type="text" placeholder="e.g. 10.00 (optional)"/>
    </div>
    <div class="btn-row">
      <button id="preview" class="btn">Preview</button>
      <span class="hint">Uses <code>/api/policy/preview</code></span>
    </div>
  </div>

  <!-- Price Watch -->
  <div class="card">
    <div class="section-title">Price Watch</div>
    <div class="row">
      <label for="mockCents">Mock Price (cents)</label>
      <input id="mockCents" type="text" placeholder="e.g. 1000 = $10.00"/>
    </div>
    <div class="btn-row">
      <button id="dryRun" class="btn">Dry Run</button>
      <button id="runSend" class="btn">Run &amp; Send</button>
      <span class="hint">Uses <code>/api/cron/price-watch</code></span>
    </div>
  </div>

  <!-- Output -->
  <div class="card">
    <div class="section-title">Output</div>
    <div class="btn-row" style="margin-bottom:8px;">
      <button id="clearOut" class="btn">Clear</button>
      <button id="copyOut" class="btn">Copy</button>
    </div>
    <pre id="out"></pre>
  </div>
</div>

<script>
(function () {
  const $  = (id) => document.getElementById(id);
  const out = $("out");

  // Token bootstrap: ?token=... or saved
  const qsToken = new URLSearchParams(location.search).get("token") || "";
  const saved   = localStorage.getItem("covrily_admin_token") || "";
  $("token").value = qsToken || saved;

  function getTokenOrThrow() {
    const t = $("token").value.trim();
    if (!t) throw new Error("Missing admin token.");
    return t;
  }
  function getRidOrSelected() {
    const manual = $("rid").value.trim();
    if (manual) return manual;
    const sel = $("recent");
    return sel && sel.value ? sel.value : "";
  }
  function println(x) {
    try { out.textContent += (typeof x === "string" ? x : JSON.stringify(x, null, 2)) + "\\n"; }
    catch { out.textContent += String(x) + "\\n"; }
    out.scrollTop = out.scrollHeight;
  }
  async function fetchJson(url, init) {
    const res  = await fetch(url, init);
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text; }
    if (!res.ok) {
      console.error("[UI] fetch error", url, res.status, body);
      println({ url, status: res.status, body });
      throw new Error("HTTP " + res.status);
    }
    println({ url, status: res.status, body });
    return body;
  }
  async function tryPing() {
    // Prefer /api/diag/env → fallback to /api/health
    const urls = ["/api/diag/env", "/api/health"];
    let lastErr;
    for (const u of urls) {
      try { return await fetchJson(u); } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error("Ping failed.");
  }
  function takeReceiptsFrom(body) {
    // Try the common shapes: {receipts:[...]}, {items:[...]}, direct array
    if (!body) return [];
    if (Array.isArray(body)) return body;
    if (Array.isArray(body.receipts)) return body.receipts;
    if (Array.isArray(body.items))    return body.items;
    if (Array.isArray(body.body?.receipts)) return body.body.receipts;
    return [];
  }

  // Auth buttons
  $("saveToken").onclick = () => {
    localStorage.setItem("covrily_admin_token", $("token").value.trim());
    println("Token saved.");
  };
  $("clearToken").onclick = () => {
    localStorage.removeItem("covrily_admin_token");
    $("token").value = "";
    println("Token cleared.");
  };
  $("ping").onclick = async () => {
    const r = await tryPing();
    println(r);
  };

  // Recent Receipts
  $("loadRecent").onclick = async () => {
    const token  = getTokenOrThrow();
    const search = $("search").value.trim();
    const url    = new URL("/api/receipts", location.origin);
    // Back-end supports listing when no id is specified; include helpful params:
    url.searchParams.set("limit", "25");
    if (search) url.searchParams.set("search", search);
    url.searchParams.set("token", token);
    const body = await fetchJson(url.toString());
    const arr  = takeReceiptsFrom(body);
    const sel  = $("recent");
    sel.innerHTML = "";
    if (!arr.length) {
      sel.appendChild(new Option("(no results)", ""));
      println("No receipts found for the given criteria.");
      return;
    }
    for (const r of arr) {
      const label = \`\${r.merchant || "merchant"} · \${r.order_id || "order"} · \${r.total_cents != null ? "$" + (r.total_cents/100).toFixed(2) : ""}\`;
      sel.appendChild(new Option(label, r.id));
    }
    println(\`Loaded \${arr.length} receipts.\`);
  };
  $("copyRid").onclick = async () => {
    const rid = getRidOrSelected();
    if (!rid) throw new Error("No receipt selected.");
    await navigator.clipboard.writeText(rid);
    println("Receipt ID copied.");
  };

  // Receipt & Link
  $("getLink").onclick = async () => {
    const token = getTokenOrThrow();
    const rid   = getRidOrSelected();
    if (!rid) throw new Error("Missing Receipt ID.");
    await fetchJson(\`/api/price/link?receipt_id=\${encodeURIComponent(rid)}&token=\${encodeURIComponent(token)}\`);
  };
  $("upsertLink").onclick = async () => {
    const token    = getTokenOrThrow();
    const rid      = getRidOrSelected();
    const url      = $("url").value.trim();
    const merchant = $("merchant").value.trim();
    if (!rid || !url) throw new Error("Receipt ID and Product URL are required.");
    await fetchJson(\`/api/price/link?action=upsert&receipt_id=\${encodeURIComponent(rid)}&url=\${encodeURIComponent(url)}&merchant_hint=\${encodeURIComponent(merchant)}&active=1&token=\${encodeURIComponent(token)}\`, { method: "POST" });
  };
  $("loadReceipt").onclick = async () => {
    const token = getTokenOrThrow();
    const rid   = getRidOrSelected();
    if (!rid) throw new Error("Missing Receipt ID.");
    await fetchJson(\`/api/receipts?id=\${encodeURIComponent(rid)}&token=\${encodeURIComponent(token)}\`);
  };

  // Policy Preview
  $("preview").onclick = async () => {
    const token = getTokenOrThrow();
    const rid   = getRidOrSelected();
    if (!rid) throw new Error("Missing Receipt ID.");
    const cp = $("currentPrice").value.trim();
    const url = new URL("/api/policy/preview", location.origin);
    url.searchParams.set("id", rid);
    if (cp) url.searchParams.set("current_price", cp);
    url.searchParams.set("token", token);
    await fetchJson(url.toString());
  };

  // Price Watch
  $("dryRun").onclick = async () => {
    const token = getTokenOrThrow();
    const rid   = getRidOrSelected();
    if (!rid) throw new Error("Missing Receipt ID.");
    const mock = $("mockCents").value.trim() || "1000";
    const url = new URL("/api/cron/price-watch", location.origin);
    url.searchParams.set("receipt_id", rid);
    url.searchParams.set("mock_price", mock);
    url.searchParams.set("dry", "1");
    url.searchParams.set("token", token);
    await fetchJson(url.toString());
  };
  $("runSend").onclick = async () => {
    const token = getTokenOrThrow();
    const rid   = getRidOrSelected();
    if (!rid) throw new Error("Missing Receipt ID.");
    const mock = $("mockCents").value.trim() || "1000";
    const url = new URL("/api/cron/price-watch", location.origin);
    url.searchParams.set("receipt_id", rid);
    url.searchParams.set("mock_price", mock);
    url.searchParams.set("token", token);
    await fetchJson(url.toString());
  };

  // Output controls
  $("clearOut").onclick = () => { out.textContent = ""; };
  $("copyOut").onclick  = async () => {
    await navigator.clipboard.writeText(out.textContent || "");
    println("Copied output.");
  };

  console.log("%cAdmin UI ready. Open DevTools → Console to see runtime logs.", "color:#6aa7ff");
})();
</script>
</body>
</html>`);
}
