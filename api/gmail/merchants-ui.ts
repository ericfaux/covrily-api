// api/gmail/merchants-ui.ts
// Assumes merchant payloads provide stable ids and human-friendly names; trade-off is handling
// legacy string responses in the client so the checkbox list stays usable during rollout.
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
    <p id="status" role="status"></p>
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
        const id = typeof raw.id === 'string' ? raw.id : typeof raw.domain === 'string' ? raw.domain : null;
        if (!id) return null;
        const name = typeof raw.name === 'string' && raw.name.trim().length > 0 ? raw.name.trim() : id;
        return { id, name };
      }
      return null;
    }

    async function load(){
      const list = document.getElementById('list');
      list.innerHTML = '<p>Loading...</p>';
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        const r = await fetch('/api/gmail/merchants?user=' + encodeURIComponent(user), { signal: controller.signal });
        clearTimeout(timeout);
        if (r.status === 428) {
          window.location.href = '/api/gmail/ui?user=' + encodeURIComponent(user);
          return;
        }
        if (!r.ok) {
          throw new Error('failed to load');
        }
        const data = await r.json();
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
      const status = document.getElementById('status');
      if (!(button instanceof HTMLButtonElement) || !(status instanceof HTMLElement)) {
        return;
      }
      const selected = Array.from(document.querySelectorAll('#list input[type="checkbox"]:checked')).map(cb => cb.value);
      button.disabled = true;
      status.textContent = 'Scanning…';
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
          let message = 'failed to scan';
          try {
            const payload = await ingestResp.json();
            if (payload && typeof payload.error === 'string' && payload.error.length > 0) {
              message = payload.error;
            }
          } catch (err) {
            // ignore body parse errors; we only need a fallback message
          }
          status.textContent = 'Scan failed: ' + message;
          button.disabled = false;
          return;
        }
        status.textContent = 'Scan complete! You can close this tab.';
      } catch (err) {
        status.textContent = 'Failed to save selections.';
        button.disabled = false;
      }
    };
    load();
  </script>
</body>
</html>`);
}
