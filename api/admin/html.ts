import { createClient } from "@supabase/supabase-js";

export default async function handler(req: any, res: any) {
  try {
    const user = (req.query.user as string) || "";
    const debug = req.query.debug === "1";

    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );

    let receipts: any[] = [];
    let deadlines: any[] = [];

    if (debug) {
      const [rAll, dAll] = await Promise.all([
        supabase.from("receipts")
          .select("id, user_id, merchant, order_id, total_cents, purchase_date")
          .order("purchase_date", { ascending: false })
          .limit(20),
        supabase.from("deadlines")
          .select("id, user_id, receipt_id, type, status, due_at, decision")
          .order("due_at", { ascending: true })
          .limit(20),
      ]);
      receipts = rAll.data || [];
      deadlines = dAll.data || [];
    } else {
      if (!user) return res.status(400).send("Missing ?user");
      const [rUser, dUser] = await Promise.all([
        supabase.from("receipts")
          .select("id, merchant, order_id, total_cents, purchase_date")
          .eq("user_id", user)
          .order("purchase_date", { ascending: false }),
        supabase.from("deadlines")
          .select("id, receipt_id, type, status, due_at, decision")
          .eq("user_id", user)
          .order("due_at", { ascending: true }),
      ]);
      receipts = rUser.data || [];
      deadlines = dUser.data || [];
    }

    const html = `
    <html><head>
      <title>Covrily – Developer Preview</title>
      <style>
        body{font-family:Inter,Arial,sans-serif;padding:24px;line-height:1.4}
        h2{margin:24px 0 8px}
        table{border-collapse:collapse;width:100%}
        th,td{border:1px solid #eee;padding:8px;text-align:left;font-size:14px}
        th{background:#fafafa}
        code{background:#f6f8fa;padding:2px 6px;border-radius:4px}
        .muted{color:#666}
      </style>
    </head><body>
      <h1>Covrily – Developer Preview</h1>
      <p>User: <code>${user || "(debug mode)"}</code> <span class="muted">${debug ? "debug=1 (showing any 20 rows)" : ""}</span></p>

      <h2>Receipts (${receipts.length})</h2>
      <table>
        <tr><th>Purchase Date</th><th>Merchant</th><th>Order</th><th>Total</th><th>Receipt ID</th><th class="muted">User</th></tr>
        ${receipts.map(x=>`<tr>
          <td>${x.purchase_date ?? ""}</td>
          <td>${x.merchant ?? ""}</td>
          <td>${x.order_id ?? ""}</td>
          <td>${x.total_cents ? `$${(x.total_cents/100).toFixed(2)}` : ""}</td>
          <td><code>${x.id}</code></td>
          <td class="muted"><code>${x.user_id ?? ""}</code></td>
        </tr>`).join("")}
      </table>

      <h2>Deadlines (${deadlines.length})</h2>
      <table>
        <tr><th>Due</th><th>Status</th><th>Decision</th><th>Receipt</th><th>Deadline ID</th><th class="muted">User</th></tr>
        ${deadlines.map(x=>`<tr>
          <td>${x.due_at ? new Date(x.due_at).toLocaleString() : ""}</td>
          <td>${x.status}</td>
          <td>${x.decision ?? ""}</td>
          <td><code>${x.receipt_id}</code></td>
          <td><code>${x.id}</code></td>
          <td class="muted"><code>${x.user_id ?? ""}</code></td>
        </tr>`).join("")}
      </table>
    </body></html>`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(html);
  } catch (e: any) {
    res.status(500).send(`Error: ${e?.message ?? e}`);
  }
}
