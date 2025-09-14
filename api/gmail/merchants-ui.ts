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
    body { font-family: Arial, sans-serif; background: #f5f5f5; }
    .container { max-width: 600px; margin: 40px auto; background: #fff; padding: 24px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    h1 { margin-top: 0; font-size: 24px; color: #333; }
    p { color: #555; }
    #list div { margin: 8px 0; }
    button { padding: 10px 20px; font-size: 16px; background: #0070f3; color: #fff; border: none; border-radius: 4px; cursor: pointer; }
    button:hover { background: #005bb5; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Select Merchants</h1>
    <p>Choose which merchants you want Covrily to ingest receipts from.</p>
    <div id="list">Loading...</div>
    <button id="save">Save</button>
  </div>
  <script>
    const user = ${JSON.stringify(user)};
    async function load() {
      const r = await fetch('/api/gmail/merchants?user=' + encodeURIComponent(user));
      const data = await r.json();
      const list = document.getElementById('list');
      list.innerHTML = '';
      (data.merchants || []).forEach(m => {
        const label = document.createElement('label');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = m;
        label.appendChild(cb);
        label.appendChild(document.createTextNode(' ' + m));
        const div = document.createElement('div');
        div.appendChild(label);
        list.appendChild(div);
      });
      if (!data.merchants || data.merchants.length === 0) {
        list.textContent = 'No merchants found.';
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
