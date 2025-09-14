// api/gmail/ui.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const user = (req.query.user as string) || "";
  const status = (req.query.status as string) || "";
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  if (!user) {
    res.status(400).send("Missing user param");
    return;
  }

  let bodyContent = "";
  if (status === "error") {
    bodyContent = "<p class='error'>Failed to link Gmail. Please try again.</p>";
  } else {
    bodyContent = "<p>We need permission to scan your inbox for receipts.</p><button id='link'>Link Gmail</button>";
  }

  res.status(200).send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Link Gmail</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 40px auto; max-width: 600px; line-height: 1.6; text-align: center; }
    button { padding: 0.6rem 1.2rem; font-size: 1rem; cursor: pointer; }
    .error { color: #b00020; }
  </style>
</head>
<body>
  <main>
    <h1>Connect your Gmail</h1>
    ${bodyContent}
  </main>
  <script>
    const user = ${JSON.stringify(user)};
    const btn = document.getElementById('link');
    if (btn) btn.onclick = () => { location.href = '/api/gmail/auth?user=' + encodeURIComponent(user); };
  </script>
</body>
</html>`);
}

