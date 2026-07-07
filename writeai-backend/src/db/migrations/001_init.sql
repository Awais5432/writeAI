-- migrations/001_init.sql

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  avatar_url TEXT,
  google_id VARCHAR(255) UNIQUE,
  plan VARCHAR(20) DEFAULT 'free',
  stripe_customer_id VARCHAR(255),
  stripe_subscription_id VARCHAR(255),
  subscription_status VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  action VARCHAR(50) NOT NULL,
  model VARCHAR(50),
  input_tokens INT,
  output_tokens INT,
  month_year VARCHAR(7),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_usage_user_month ON usage(user_id, month_year);

CREATE TABLE monthly_counts (
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  month_year VARCHAR(7),
  action_count INT DEFAULT 0,
  PRIMARY KEY (user_id, month_year)
);
