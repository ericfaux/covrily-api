// Assumptions: Gmail merchants API returns 200 when ready and 428 when reauth is required.
// Trade-offs: Client-side status fetch adds a slight delay but keeps the manual link fallback visible for failures.
import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const user = (req.query.user as string) || "";
  const status = (req.query.status as string) || "";
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  if (!user) {
    res.status(400).send("Missing user param");
    return;
  }

  const errorMessage =
    status === "error" ? "Failed to link Gmail. Please try again or use the manual link below." : "";
  const initialStatus =
    status === "error"
      ? "We couldn't automatically link your Gmail. We'll retry below, or you can use the manual link."
      : "Checking your Gmail connection…";

  res.status(200).send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Link Gmail</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 40px auto; max-width: 600px; line-height: 1.6; text-align: center; }
    button { padding: 0.6rem 1.2rem; font-size: 1rem; cursor: pointer; }
    .error { color: #b00020; min-height: 1.2em; }
    #status { min-height: 1.2em; }
  </style>
</head>
<body>
  <main>
    <h1>Connect your Gmail</h1>
    <p>We need permission to scan your inbox for receipts.</p>
    <p id="status" aria-live="polite">${initialStatus}</p>
    <p id="error" class="error" role="alert">${errorMessage}</p>
    <p>If nothing happens automatically, continue with the manual link below.</p>
    <button id="link" type="button">Link Gmail manually</button>
  </main>
  <script>
    const user = ${JSON.stringify(user)};
    const statusEl = document.getElementById('status');
    const errorEl = document.getElementById('error');
    const btn = document.getElementById('link');
    const manualUrl = '/api/gmail/auth?user=' + encodeURIComponent(user);

    if (btn) {
      btn.onclick = () => {
        location.href = manualUrl;
      };
    }

    async function loadStatus() {
      if (!user) {
        return;
      }

      if (errorEl) {
        errorEl.textContent = '';
      }

      if (statusEl) {
        statusEl.textContent = 'Checking your Gmail connection…';
      }

      try {
        const merchantsResponse = await fetch('/api/gmail/merchants?user=' + encodeURIComponent(user), {
          headers: { Accept: 'application/json' },
          credentials: 'same-origin',
        });

        if (merchantsResponse.status === 200) {
          location.replace('/api/gmail/merchants-ui?user=' + encodeURIComponent(user));
          return;
        }

        if (merchantsResponse.status === 428) {
          if (statusEl) {
            statusEl.textContent = 'We need you to reauthorize access with Google.';
          }

          const reauthResponse = await fetch('/api/connectors/gmail/reauthorize', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify({ user }),
            credentials: 'same-origin',
          });

          if (!reauthResponse.ok) {
            throw new Error('Failed to start reauthorization (status ' + reauthResponse.status + ')');
          }

          const payload = await reauthResponse.json();
          let authUrl = '';
          if (payload && typeof payload === 'object') {
            if (typeof payload.authUrl === 'string' && payload.authUrl.trim()) {
              authUrl = payload.authUrl.trim();
            } else if (typeof payload.url === 'string' && payload.url.trim()) {
              authUrl = payload.url.trim();
            }
          }

          if (authUrl) {
            if (statusEl) {
              statusEl.textContent = 'Redirecting you to Google…';
            }
            location.assign(authUrl);
            return;
          }

          throw new Error('Missing authorization URL from reauthorize endpoint');
        }

        const detailText = await merchantsResponse.text().catch(() => '');
        throw new Error(detailText || 'Unexpected response status ' + merchantsResponse.status);
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : 'An unexpected error occurred while checking your Gmail status. Please use the manual link below.';

        if (statusEl) {
          statusEl.textContent =
            'We could not automatically check your Gmail connection. You can still continue using the manual link below.';
        }

        if (errorEl) {
          errorEl.textContent = message;
        }
      }
    }

    void loadStatus();
  </script>
</body>
</html>`);
}

