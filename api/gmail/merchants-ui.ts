// api/gmail/merchants-ui.ts
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
  </style>
</head>
<body>
  <main>
    <h1>Select merchants</h1>
    <p>Choose the merchants whose receipts you'd like to import.</p>
    <div id="list"></div>
    <button id="save">Save</button>
  </main>
  <script>
    const user = ${JSON.stringify(user)};
    async function load(){
      const list = document.getElementById('list');
      list.innerHTML = '<p>Loading...</p>';
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        const r = await fetch('/api/gmail/merchants?user=' + encodeURIComponent(user), { signal: controller.signal });
        clearTimeout(timeout);
        const data = await r.json();
        if (!data.merchants || data.merchants.length === 0) {
          list.innerHTML = '<p>No merchants found.</p>';
          return;
        }
        list.innerHTML = '';
        (data.merchants || []).forEach(m => {
          const label = document.createElement('label');
          label.className = 'merchant';
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.value = m;
          label.appendChild(cb);
          label.appendChild(document.createTextNode(m));
          list.appendChild(label);
        });
      } catch (err) {
        list.innerHTML = '<p style="color:red">Failed to load merchants.</p>';
      }
    }
    document.getElementById('save').onclick = async () => {
      const selected = Array.from(document.querySelectorAll('#list input[type="checkbox"]:checked')).map(cb => cb.value);
      await fetch('/api/gmail/merchants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user, merchants: selected })
      });
      await fetch('/api/gmail/ingest?user=' + encodeURIComponent(user), { method: 'POST' });
      alert('Saved');
    };
    load();
  </script>
</body>
</html>`);
}
