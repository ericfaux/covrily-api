-- Create indexes to optimize deadline and receipt lookups
CREATE INDEX IF NOT EXISTS deadlines_due_at_idx ON public.deadlines (user_id, status, due_at);
CREATE INDEX IF NOT EXISTS receipts_id_user_idx ON public.receipts (id, user_id);
