Postmark
 -User Name: Covrily
 -Inbound Email Address: 2bab2994ebb7aba47a2bbf1028fc422d@inbound.postmarkapp.com
 -Inbound Webhook: https://covrily-api.vercel.app/api/inbound/postmark
   -Using Test site for now
SupaBase
  -Database (Table and Column Names) : Found in file covrily-context-docs/Supabase_db.sql
  -Storage: Receipts

Vercel
  -Domain: https://covrily-api.vercel.app/
  -Environment Variables (with current values)
    -SUPABASE_SERVICE_ROLE_KEY: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFtYmxzcGV2aXZ2eWp5d25nendkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NzExNjMwNiwiZXhwIjoyMDcyNjkyMzA2fQ.tB4BLO-5esp9YVYSSTXDB_dAkmt0do3uhJVxzyUWqlE
    -SUPABASE_URL: https://amblspevivvyjywngzwd.supabase.co
    -EMAIL_FROM:no-reply@covrily.com
    -POSTMARK_SERVER_TOKEN: dc4c9dc5-0b76-430d-9042-f0fe5a37c0ca
    -NOTIFY_TO: eric.faux@covrily.com
    -POSTMARK_TOKEN: dc4c9dc5-0b76-430d-9042-f0fe5a37c0ca
    -POSTMARK_FROM: no-reply@covrily.com
    -USE_NOTIFY_TO_FALLBACK: false
    -DEBUG_EMAIL_ROUTING: false
    -ADMIN_TOKEN: ETETOPOP159
      -typically used for the admin UI
    -ALLOW_QUERY_TOKEN: true
    -RECEIPTS_BUCKET: receipts
      -this matches the receipts storage bucket in supabase
    -INBOUND_DEFAULT_USER_ID: d6756d38-a8fb-4705-bd26-05d4022d9800
    -INBOUND_DEFAULT_USER_ID: true
   

 
