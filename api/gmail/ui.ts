// api/gmail/ui.ts
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
<head><meta charset="utf-8" /><title>Link Gmail</title></head>
<body>
  <button onclick="location.href='/api/gmail/auth?user=${encodeURIComponent(user)}'">Link Gmail</button>
</body>
</html>`);
}
