// PATH: api/gmail/merchants-ui.ts
// Assumes transitional UI continues to rely on query-string user ids; trade-off is keeping the
// lightweight HTML helper available for manual testing even though new authenticated flows should
// migrate to the JSON API directly.
import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const user = (req.query.user as string) || "";
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  if (!user) {
    res.status(400).send("Missing user param");
    return;
  }

  res.status(200).send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Authorize Merchants</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 40px auto; max-width: 600px; line-height: 1.6; }
    h1 { text-align: center; }
    #list { margin: 1rem 0; }
    .merchant { display: flex; align-items: center; margin: 0.25rem 0; }
    .merchant input { margin-right: 0.5rem; }
    #save { padding: 0.5rem 1rem; font-size: 1rem; cursor: pointer; }
    #status { margin-top: 1rem; font-style: italic; }
  </style>
</head>
<body>
  <main>
    <h1>Select merchants</h1>
    <p>Choose the merchants whose receipts you'd like to import.</p>
    <div id="list"></div>
    <button id="save">Save</button>
    <p id="msg" role="status"></p>
  </main>
  <script>
    const user = ${JSON.stringify(user)};
    function extractMerchantInfo(raw) {
      if (!raw) return null;
      if (typeof raw === 'string') {
        const id = raw.trim();
        if (!id) return null;
        return { id, name: id };
      }
      if (typeof raw === 'object') {
        const id = typeof raw.domain === 'string' ? raw.domain : typeof raw.id === 'string' ? raw.id : null;
        if (!id) return null;
        const name = typeof raw.merchant === 'string' && raw.merchant.trim().length > 0 ? raw.merchant.trim() : id;
        const count = typeof raw.count === 'number' ? raw.count : null;
        const label = count && count > 1 ? name + ' (' + count + ')' : name;
        return { id, name: label };
      }
      return null;
    }

    async function load(){
      const list = document.getElementById('list');
      list.innerHTML = '<p>Loading...</p>';
      try {
        const probeResp = await fetch('/api/gmail/merchants?user=' + encodeURIComponent(user));
        if (probeResp.status === 401) {
          const payload = await probeResp.json().catch(() => ({}));
          if (payload && payload.reauthorize) {
            window.location.href = '/api/gmail/ui?user=' + encodeURIComponent(user);
            return;
          }
          throw new Error('probe_failed');
        }
        if (!probeResp.ok) {
          throw new Error('probe_failed');
        }

        const discoveryResp = await fetch('/api/gmail/merchants?user=' + encodeURIComponent(user), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lookbackDays: 90, maxMessages: 50 })
        });
        if (discoveryResp.status === 401) {
          const payload = await discoveryResp.json().catch(() => ({}));
          if (payload && payload.reauthorize) {
            window.location.href = '/api/gmail/ui?user=' + encodeURIComponent(user);
            return;
          }
          throw new Error('discovery_failed');
        }
        if (!discoveryResp.ok) {
          throw new Error('discovery_failed');
        }
        const data = await discoveryResp.json();
        const merchants = Array.isArray(data.merchants) ? data.merchants : [];
        if (merchants.length === 0) {
          list.innerHTML = '<p>No merchants found.</p>';
          return;
        }
        list.innerHTML = '';
        merchants.forEach((raw) => {
          const merchant = extractMerchantInfo(raw);
          if (!merchant) return;
          const label = document.createElement('label');
          label.className = 'merchant';
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.value = merchant.id;
          label.appendChild(cb);
          label.appendChild(document.createTextNode(merchant.name));
          list.appendChild(label);
        });
      } catch (err) {
        list.innerHTML = '<p style="color:red">Failed to load merchants.</p>';
      }
    }
    document.getElementById('save').onclick = async () => {
      const button = document.getElementById('save');
      const msgEl = document.getElementById('msg');
      if (!(button instanceof HTMLButtonElement) || !(msgEl instanceof HTMLElement)) {
        return;
      }
      const selected = Array.from(document.querySelectorAll('#list input[type="checkbox"]:checked')).map(cb => cb.value);
      button.disabled = true;
      msgEl.textContent = 'Scanning…';
      try {
        const saveResp = await fetch('/api/gmail/merchants', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user, merchants: selected })
        });
        if (!saveResp.ok) {
          throw new Error('save_failed');
        }
        const ingestResp = await fetch('/api/gmail/ingest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user })
        });
        if (!ingestResp.ok) {
          let errText = '';
          try {
            errText = await ingestResp.text();
          } catch (err) {
            errText = '';
          }
          const message = errText && errText.trim().length > 0 ? errText.trim() : 'unknown error';
          msgEl.textContent = 'Scan failed: ' + message;
          button.disabled = false;
          return;
        }
        msgEl.textContent = 'Scan complete! You can close this tab.';
      } catch (err) {
        msgEl.textContent = 'Failed to save selections.';
        button.disabled = false;
      }
    };
    load();
  </script>
</body>
</html>`);
}
