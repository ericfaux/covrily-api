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
<head><meta charset="utf-8" /><title>Authorize Merchants</title></head>
<body>
  <div id="list"></div>
  <button id="save">Save</button>
  <script>
    const user = ${JSON.stringify(user)};
    async function load(){
      const r = await fetch('/api/gmail/merchants?user=' + encodeURIComponent(user));
      const data = await r.json();
      const list = document.getElementById('list');
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
    }
    document.getElementById('save').onclick = async () => {
      const selected = Array.from(document.querySelectorAll('#list input[type="checkbox"]:checked')).map(cb => cb.value);
      await fetch('/api/gmail/merchants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user, merchants: selected })
      });
      // trigger receipt ingestion without blocking the UI
      fetch('/api/gmail/ingest?user=' + encodeURIComponent(user), { method: 'POST' }).catch(() => {});
      alert('Saved');
    };
    load();
  </script>
</body>
</html>`);
}
