// api/gmail/merchants-ui.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { listCandidateMerchants } from "../../lib/gmail-scan.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const user = (req.query.user as string) || "";
  if (!user) return res.status(400).send("Missing user param");

  try {
    const merchants = await listCandidateMerchants(user);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><title>Select Merchants</title></head>
<body>
  <h1>Select merchants to authorize</h1>
  <form id="mform">
    ${merchants
      .map(
        (m) =>
          `<label><input type="checkbox" name="merchants" value="${m}" /> ${m}</label><br/>`
      )
      .join("\n")}
    <button type="submit">Save</button>
  </form>
  <div id="status"></div>
  <script>
    const form = document.getElementById('mform');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = Array.from(form.querySelectorAll('input[name=merchants]:checked')).map(i => i.value);
      const r = await fetch('/api/gmail/merchants?user=${encodeURIComponent(
        user
      )}', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merchants: data })
      });
      const out = await r.json();
      document.getElementById('status').innerText = out.ok ? 'Saved!' : out.error;
    });
  </script>
</body>
</html>`);
  } catch (e: any) {
    res.status(400).send(String(e?.message || e));
  }
}
