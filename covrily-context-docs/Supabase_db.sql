-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.claims (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  receipt_id uuid,
  type text,
  status text DEFAULT 'draft'::text,
  payload jsonb,
  submitted_at timestamp with time zone,
  CONSTRAINT claims_pkey PRIMARY KEY (id),
  CONSTRAINT claims_receipt_id_fkey FOREIGN KEY (receipt_id) REFERENCES public.receipts(id),
  CONSTRAINT claims_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.deadlines (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  receipt_id uuid,
  type text CHECK (type = ANY (ARRAY['return'::text, 'price_adjust'::text, 'warranty'::text])),
  due_at timestamp with time zone,
  status text DEFAULT 'open'::text,
  last_notified_at timestamp with time zone,
  source_policy_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  heads_up_notified_at timestamp with time zone,
  decision text CHECK (decision = ANY (ARRAY['return'::text, 'keep'::text])),
  decision_note text,
  closed_at timestamp with time zone,
  CONSTRAINT deadlines_pkey PRIMARY KEY (id),
  CONSTRAINT deadlines_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT deadlines_receipt_id_fkey FOREIGN KEY (receipt_id) REFERENCES public.receipts(id),
  CONSTRAINT deadlines_source_policy_id_fkey FOREIGN KEY (source_policy_id) REFERENCES public.policies(id)
);
CREATE TABLE public.decisions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL,
  user_id uuid NOT NULL,
  decision text NOT NULL CHECK (decision = ANY (ARRAY['keep'::text, 'return'::text, 'price_adjust'::text])),
  delta_cents integer,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT decisions_pkey PRIMARY KEY (id),
  CONSTRAINT decisions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT decisions_receipt_id_fkey FOREIGN KEY (receipt_id) REFERENCES public.receipts(id)
);
CREATE TABLE public.inbound_emails (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  provider text DEFAULT 'postmark'::text,
  payload jsonb,
  processed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  error text,
  CONSTRAINT inbound_emails_pkey PRIMARY KEY (id),
  CONSTRAINT inbound_emails_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.line_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  receipt_id uuid,
  product_id uuid,
  name text,
  qty integer,
  unit_cents integer,
  CONSTRAINT line_items_pkey PRIMARY KEY (id),
  CONSTRAINT line_items_receipt_id_fkey FOREIGN KEY (receipt_id) REFERENCES public.receipts(id),
  CONSTRAINT line_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id)
);
CREATE TABLE public.policies (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  merchant text,
  type text,
  rules jsonb,
  last_reviewed_at timestamp with time zone,
  CONSTRAINT policies_pkey PRIMARY KEY (id)
);
CREATE TABLE public.price_observations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL,
  observed_price_cents integer NOT NULL,
  source text NOT NULL,
  raw_excerpt text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT price_observations_pkey PRIMARY KEY (id),
  CONSTRAINT price_observations_receipt_id_fkey FOREIGN KEY (receipt_id) REFERENCES public.receipts(id)
);
CREATE TABLE public.product_links (
  receipt_id uuid NOT NULL UNIQUE,
  url text NOT NULL CHECK (url ~* '^https?://'::text),
  merchant_hint text,
  selector text,
  active boolean DEFAULT true,
  last_notified_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT product_links_pkey PRIMARY KEY (receipt_id),
  CONSTRAINT product_links_receipt_id_fkey FOREIGN KEY (receipt_id) REFERENCES public.receipts(id)
);
CREATE TABLE public.products (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  brand text,
  model text,
  upc text,
  serial text,
  category text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT products_pkey PRIMARY KEY (id),
  CONSTRAINT products_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.profiles (
  id uuid NOT NULL,
  email text NOT NULL,
  full_name text,
  timezone text DEFAULT 'UTC'::text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT profiles_pkey PRIMARY KEY (id),
  CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id)
);
CREATE TABLE public.push_tokens (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  token text UNIQUE,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT push_tokens_pkey PRIMARY KEY (id),
  CONSTRAINT push_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.receipts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  merchant text,
  order_id text NOT NULL DEFAULT ''::text,
  total_cents integer,
  tax_cents integer,
  currency text DEFAULT 'USD'::text,
  purchase_date date,
  channel text,
  raw_url text,
  raw_json jsonb,
  created_at timestamp with time zone DEFAULT now(),
  shipping_cents integer,
  subtotal_cents integer,
  CONSTRAINT receipts_pkey PRIMARY KEY (id),
  CONSTRAINT receipts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
