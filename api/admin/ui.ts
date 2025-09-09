// /api/admin/ui.ts
// Serves a simple admin UI page. Runtime: node.
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { runtime: "nodejs" };

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Covrily – Admin UI</title>
<style>
  :root { --bg:#0b1320; --panel:#121a2b; --border:#1d2942; --text:#e8efff; --muted:#9fb2d0; --accent:#6aa7ff; --btn:#1f2a44; --btn-hover:#2a3b63; }
  * { box-sizing:border-box; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji","Segoe UI Emoji"; }
  body { margin:0; background:var(--bg); color:var(--text); }
  .wrap { max-width:960px; margin:32px auto; padding:0 16px; }
  h1 { font-size:20px; margin:0 0 16px 0; }
  .card { background:var(--panel); border:1px solid var(--border); border-radius:12px; padding:16px; margin:16px 0; }
  .row { display:grid; grid-template-columns:160px 1fr; gap:12px; align-items:center; margin:10px 0; }
  label { color:var(--muted); font-size:12px; }
  input[type="text"] { width:100%; padding:10px 12px; color:var(--text); background:#0e1830; border:1px solid var(--border); border-radius:10px; }
  .btn { display:inline-flex; gap:6px; align-items:center; background:var(--btn); color:var(--text); border:1px solid var(--border); padding:8px 12px; border-radius:10px; cursor:pointer; }
  .btn:hover { background:var(--btn-hover); }
  .btn-row { display:flex; gap:8px; flex-wrap:wrap; }
  .hint { color:var(--muted); font-size:12px; }
  pre { background:#0a1020; color:#e9f1ff; border:1px solid var(--border); border-radius:12px; padding:12px; min-height:160px; overflow:auto; }
  .section-title { font-weight:600; margin-bottom:6px; color:#cfe0ff; }
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
        <input id="token" type="text" placeholder="ETETOPOP159" />
      </div>
      <div class="btn-row">
        <button id="saveToken" class="btn">Save token</button>
        <button id="clearToken" class="btn">Clear</button>
        <button id="ping" class="btn">Ping</button>
      </div>
      <div class="hint">Tip: token is saved in localStorage on this device only.</div>
    </div>

    <!-- Receipt & Link -->
    <div class="card">
      <div class="section-title">Receipt & Link</div>
      <div class="row">
        <label for="rid">Receipt ID</label>
        <input id="rid" type="text" placeholder="UUID of receipts.id">
      </div>
      <div class="row">
        <label for="url">Product URL</label>
        <input id="url" type="text" placeholder="https://example.com/product/123">
      </div>
      <div class="row">
        <label for="merchant">Merchant Hint</label>
        <input id="merchant" type="text" placeholder="Best Buy (optional)">
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
        <input id="currentPrice" type="text" placeholder="e.g. 10.00 (optional)">
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
        <input id="mockCents" type="text" placeholder="e.g. 1000 = $10.00">
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
  const $ = (id) => document.getElementById(id);
  const out = $("out");

  const qsToken = new URLSearchParams(location.search).get("token") || "";
  const savedToken = localStorage.getItem("covrily_admin_token") || "";
  $("token").value = qsToken || savedToken;

  function getTokenOrThrow() {
    const t = $("token").value.trim();
    if (!t) throw new Error("Missing admin token.");
    return t;
  }
  function println(x) {
    try { out.textContent += (typeof x === "string" ? x : JSON.stringify(x, null, 2)) + "\\n"; }
    catch { out.textContent += String(x) + "\\n"; }
    out.scrollTop = out.scrollHeight;
  }
  function clearOut() { out.textContent = ""; }
  async function fetchJson(url, init) {
    const res = await fetch(url, init);
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text; }
    if (!res.ok) {
      const err = new Error("HTTP " + res.status + " — " + (res.statusText || ""));
      console.error("[UI] fetch error", url, res.status, body);
      println({ url, status: res.status, body });
      throw err;
    }
    println({ url, status: res.status, body });
    return body;
  }

  // Buttons
  $("saveToken").onclick = () => {
    const t = $("token").value.trim();
    localStorage.setItem("covrily_admin_token", t);
    println("Token saved.");
  };
  $("clearToken").onclick = () => {
    localStorage.removeItem("covrily_admin_token");
    $("token").value = "";
    println("Token cleared.");
  };
  $("ping").onclick = async () => {
    const token = getTokenOrThrow();
    await fetchJson(\`/api/health?token=\${encodeURIComponent(token)}\`);
  };

  $("getLink").onclick = async () => {
    const token = getTokenOrThrow();
    const rid = $("rid").value.trim();
    if (!rid) throw new Error("Missing Receipt ID.");
    await fetchJson(\`/api/price/link?receipt_id=\${encodeURIComponent(rid)}&token=\${encodeURIComponent(token)}\`);
  };

  $("upsertLink").onclick = async () => {
    const token = getTokenOrThrow();
    const rid = $("rid").value.trim();
    const url = $("url").value.trim();
    const merchant = $("merchant").value.trim();
    if (!rid || !url) throw new Error("Receipt ID and Product URL are required.");
    await fetchJson(\`/api/price/link?action=upsert&receipt_id=\${encodeURIComponent(rid)}&url=\${encodeURIComponent(url)}&merchant_hint=\${encodeURIComponent(merchant)}&active=1&token=\${encodeURIComponent(token)}\`, { method: "POST" });
  };

  $("loadReceipt").onclick = async () => {
    const token = getTokenOrThrow();
    const rid = $("rid").value.trim();
    if (!rid) throw new Error("Missing Receipt ID.");
    await fetchJson(\`/api/receipts?id=\${encodeURIComponent(rid)}&token=\${encodeURIComponent(token)}\`);
  };

  $("preview").onclick = async () => {
    const token = getTokenOrThrow();
    const rid = $("rid").value.trim();
    const cp = $("currentPrice").value.trim();
    const url = new URL(\`/api/policy/preview\`, location.origin);
    url.searchParams.set("id", rid);
    if (cp) url.searchParams.set("current_price", cp);
    url.searchParams.set("token", token);
    await fetchJson(url.toString());
  };

  $("dryRun").onclick = async () => {
    const token = getTokenOrThrow();
    const rid = $("rid").value.trim();
    const mock = $("mockCents").value.trim() || "1000";
    const url = new URL(\`/api/cron/price-watch\`, location.origin);
    url.searchParams.set("receipt_id", rid);
    url.searchParams.set("mock_price", mock);
    url.searchParams.set("dry", "1");
    url.searchParams.set("token", token);
    await fetchJson(url.toString());
  };

  $("runSend").onclick = async () => {
    const token = getTokenOrThrow();
    const rid = $("rid").value.trim();
    const mock = $("mockCents").value.trim() || "1000";
    const url = new URL(\`/api/cron/price-watch\`, location.origin);
    url.searchParams.set("receipt_id", rid);
    url.searchParams.set("mock_price", mock);
    url.searchParams.set("token", token);
    await fetchJson(url.toString());
  };

  $("clearOut").onclick = clearOut;
  $("copyOut").onclick = async () => {
    await navigator.clipboard.writeText(out.textContent || "");
    println("Copied output.");
  };

  // Helpful console message
  console.log("%cAdmin UI ready. Open the Console to see any runtime errors.", "color:#6aa7ff");
})();
</script>
</body></html>`);
}
