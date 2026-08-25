-- barbers table
CREATE TABLE IF NOT EXISTS barbers (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  tier TEXT NOT NULL DEFAULT 'starter',
  credits_remaining INTEGER NOT NULL DEFAULT 0,
  monthly_credit_allowance INTEGER NOT NULL DEFAULT 100,
  account_status TEXT NOT NULL DEFAULT 'active',
  billing_cycle_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  low_credit_warning_sent BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE barbers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Barbers can read own record"
  ON barbers FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Barbers can update own record"
  ON barbers FOR UPDATE
  USING (auth.uid() = id);

-- demo_pool table
CREATE TABLE IF NOT EXISTS demo_pool (
  id INTEGER PRIMARY KEY DEFAULT 1,
  credits_remaining INTEGER NOT NULL DEFAULT 500
);

INSERT INTO demo_pool (id, credits_remaining) VALUES (1, 500)
  ON CONFLICT (id) DO NOTHING;

-- demo_usage table
CREATE TABLE IF NOT EXISTS demo_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_address TEXT NOT NULL,
  used_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS demo_usage_ip_idx ON demo_usage(ip_address);
