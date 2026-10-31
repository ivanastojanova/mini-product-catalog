CREATE TABLE payment_intents (
  id TEXT PRIMARY KEY NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'requires_payment',
  metadata_order_id TEXT NOT NULL,
  return_url TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  CONSTRAINT payment_intents_amount_positive CHECK (amount_cents > 0),
  CONSTRAINT payment_intents_status_valid CHECK (status IN ('requires_payment', 'succeeded', 'failed', 'refunded'))
);

CREATE TABLE events (
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL,
  intent_id TEXT NOT NULL REFERENCES payment_intents(id),
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  delivered_at INTEGER,
  delivery_attempts INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT events_type_valid CHECK (type IN ('payment_intent.succeeded', 'payment_intent.payment_failed')),
  CONSTRAINT events_attempts_non_negative CHECK (delivery_attempts >= 0)
);

CREATE INDEX events_intent_id_idx ON events (intent_id);

CREATE TABLE refunds (
  id TEXT PRIMARY KEY NOT NULL,
  intent_id TEXT NOT NULL UNIQUE REFERENCES payment_intents(id),
  amount_cents INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  CONSTRAINT refunds_amount_positive CHECK (amount_cents > 0)
);

CREATE TABLE idempotency_keys (
  key TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (key, endpoint)
);
