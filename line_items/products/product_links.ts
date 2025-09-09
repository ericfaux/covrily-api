// PSEUDO-code inside api/inbound/postmark.ts after you have receiptId
// assume `parsed.items` = [{ title, qty, unit_cents, total_cents, brand, model, upc, url? }, ...]
for (const it of parsed.items ?? []) {
  let productId: string | null = null;

  if (it.upc || it.model) {
    const { data: p } = await supabase
      .from("products")
      .upsert([{ upc: it.upc ?? null, brand: it.brand ?? null, model: it.model ?? null }], { onConflict: "upc" })
      .select("id").single().catch(() => ({ data: null }));
    productId = p?.id ?? null;
  }

  await supabase.from("line_items").insert([{
    receipt_id: receiptId,
    product_id: productId,
    title: it.title ?? null,
    sku: it.sku ?? null,
    upc: it.upc ?? null,
    serial: it.serial ?? null,
    qty: it.qty ?? null,
    unit_cents: it.unit_cents ?? null,
    total_cents: it.total_cents ?? null,
  }]);

  if (it.url) {
    await supabase.from("product_links").upsert([{
      receipt_id: receiptId,
      url: it.url,
      merchant_hint: merchant,
      active: true
    }]);
  }
}

// OPTIONAL: if you extracted tax/shipping from the email/PDF
await supabase.from("receipts")
  .update({ tax_cents: parsed.tax_cents ?? null, shipping_cents: parsed.shipping_cents ?? null })
  .eq("id", receiptId);
