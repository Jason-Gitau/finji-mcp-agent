-- Database Schema for Finji M-Pesa MCP Server
-- Run this in your Supabase SQL editor

-- 1. Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Business profiles table
CREATE TABLE IF NOT EXISTS business_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  industry TEXT DEFAULT 'general',
  phone TEXT,
  email TEXT,
  kra_pin TEXT,
  average_transaction_size DECIMAL DEFAULT 1000,
  peak_hours TEXT[] DEFAULT ARRAY['09:00-17:00'],
  common_counterparties TEXT[] DEFAULT ARRAY[]::TEXT[],
  suspicious_patterns TEXT[] DEFAULT ARRAY[]::TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Transactions table (main M-Pesa data)
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID REFERENCES business_profiles(id) ON DELETE CASCADE,
  transaction_id TEXT NOT NULL,
  date DATE NOT NULL,
  time TEXT,
  type TEXT NOT NULL CHECK (type IN ('received', 'sent', 'withdraw', 'deposit', 'paybill', 'buy_goods', 'airtime', 'fuliza')),
  amount DECIMAL NOT NULL,
  transaction_cost DECIMAL DEFAULT 0,
  counterparty TEXT,
  counterparty_phone TEXT,
  account_number TEXT,
  reference TEXT,
  balance_after DECIMAL,
  raw_text TEXT,
  confidence_score DECIMAL DEFAULT 0.8,
  network TEXT DEFAULT 'mpesa' CHECK (network IN ('mpesa', 'airtel', 'tkash', 'international')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Indexes for performance
  UNIQUE(business_id, transaction_id, date)
);

-- 4. Categorized transactions table
CREATE TABLE IF NOT EXISTS categorized_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID REFERENCES business_profiles(id) ON DELETE CASCADE,
  transaction_id UUID REFERENCES transactions(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  category_confidence DECIMAL DEFAULT 0.5,
  suggested_vat_rate DECIMAL DEFAULT 0,
  business_impact TEXT CHECK (business_impact IN ('positive', 'negative', 'neutral')),
  manual_override BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(transaction_id)
);

-- 5. Learning patterns table (for ML improvement)
CREATE TABLE IF NOT EXISTS learning_patterns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID REFERENCES business_profiles(id) ON DELETE CASCADE,
  counterparty_pattern TEXT,
  amount_range TEXT CHECK (amount_range IN ('micro', 'small', 'medium', 'large', 'very_large')),
  category TEXT,
  confidence DECIMAL,
  usage_count INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Business memory table (for context and preferences)
CREATE TABLE IF NOT EXISTS business_memory (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID REFERENCES business_profiles(id) ON DELETE CASCADE,
  preference_type TEXT NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  INDEX (business_id, preference_type)
);

-- 7. Book entries table (for reconciliation)
CREATE TABLE IF NOT EXISTS book_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID REFERENCES business_profiles(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  amount DECIMAL NOT NULL,
  description TEXT,
  account_type TEXT CHECK (account_type IN ('revenue', 'expense', 'asset', 'liability')),
  reference TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. Anomaly detections table
CREATE TABLE IF NOT EXISTS anomaly_detections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID REFERENCES business_profiles(id) ON DELETE CASCADE,
  transaction_id UUID REFERENCES transactions(id) ON DELETE CASCADE,
  anomaly_types TEXT[] NOT NULL,
  risk_score DECIMAL NOT NULL,
  recommendation TEXT,
  requires_immediate_attention BOOLEAN DEFAULT FALSE,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'resolved', 'false_positive')),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. Performance indexes
CREATE INDEX IF NOT EXISTS idx_transactions_business_id ON transactions(business_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
CREATE INDEX IF NOT EXISTS idx_transactions_amount ON transactions(amount);
CREATE INDEX IF NOT EXISTS idx_categorized_transactions_business_id ON categorized_transactions(business_id);
CREATE INDEX IF NOT EXISTS idx_learning_patterns_business_id ON learning_patterns(business_id);
CREATE INDEX IF NOT EXISTS idx_anomaly_detections_business_id ON anomaly_detections(business_id);
CREATE INDEX IF NOT EXISTS idx_anomaly_detections_status ON anomaly_detections(status);

-- 10. Row Level Security (RLS) policies
ALTER TABLE business_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE categorized_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE book_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE anomaly_detections ENABLE ROW LEVEL SECURITY;

-- Business profiles policy
CREATE POLICY "Users can view their own business profiles" ON business_profiles
  FOR SELECT USING (id::text = current_setting('request.jwt.claims', true)::json->>'business_id');

CREATE POLICY "Users can update their own business profiles" ON business_profiles
  FOR UPDATE USING (id::text = current_setting('request.jwt.claims', true)::json->>'business_id');

-- Transactions policy
CREATE POLICY "Users can view their own transactions" ON transactions
  FOR SELECT USING (business_id::text = current_setting('request.jwt.claims', true)::json->>'business_id');

CREATE POLICY "Service can insert transactions" ON transactions
  FOR INSERT WITH CHECK (true);

-- Similar policies for other tables
CREATE POLICY "Users can view their own categorized transactions" ON categorized_transactions
  FOR SELECT USING (business_id::text = current_setting('request.jwt.claims', true)::json->>'business_id');

CREATE POLICY "Service can manage categorized transactions" ON categorized_transactions
  FOR ALL WITH CHECK (true);

CREATE POLICY "Service can manage learning patterns" ON learning_patterns
  FOR ALL WITH CHECK (true);

CREATE POLICY "Service can manage business memory" ON business_memory
  FOR ALL WITH CHECK (true);

CREATE POLICY "Users can view their own book entries" ON book_entries
  FOR SELECT USING (business_id::text = current_setting('request.jwt.claims', true)::json->>'business_id');

CREATE POLICY "Service can manage book entries" ON book_entries
  FOR ALL WITH CHECK (true);

CREATE POLICY "Users can view their own anomaly detections" ON anomaly_detections
  FOR SELECT USING (business_id::text = current_setting('request.jwt.claims', true)::json->>'business_id');

CREATE POLICY "Service can manage anomaly detections" ON anomaly_detections
  FOR ALL WITH CHECK (true);

-- 11. Functions for automated updates
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$ language 'plpgsql';

-- Add triggers for updated_at
CREATE TRIGGER update_business_profiles_updated_at BEFORE UPDATE ON business_profiles 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_transactions_updated_at BEFORE UPDATE ON transactions 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_categorized_transactions_updated_at BEFORE UPDATE ON categorized_transactions 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_learning_patterns_updated_at BEFORE UPDATE ON learning_patterns 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_book_entries_updated_at BEFORE UPDATE ON book_entries 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 12. Sample data insertion function
CREATE OR REPLACE FUNCTION create_sample_business(
  business_name TEXT,
  business_phone TEXT DEFAULT '+254700123456',
  business_industry TEXT DEFAULT 'retail'
)
RETURNS UUID AS $
DECLARE
  new_business_id UUID;
BEGIN
  INSERT INTO business_profiles (name, phone, industry, average_transaction_size, peak_hours)
  VALUES (
    business_name, 
    business_phone, 
    business_industry, 
    2500, 
    ARRAY['08:00-12:00', '14:00-18:00']
  )
  RETURNING id INTO new_business_id;
  
  -- Insert some sample learning patterns
  INSERT INTO learning_patterns (business_id, counterparty_pattern, amount_range, category, confidence)
  VALUES 
    (new_business_id, 'KPLC', 'medium', 'expense_utilities_electricity', 0.95),
    (new_business_id, 'SAFARICOM', 'small', 'expense_utilities_internet', 0.90),
    (new_business_id, 'CUSTOMER', 'medium', 'income_sales', 0.85);
  
  RETURN new_business_id;
END;
$ LANGUAGE plpgsql;

-- 13. Analytics views for better performance
CREATE OR REPLACE VIEW monthly_transaction_summary AS
SELECT 
  business_id,
  DATE_TRUNC('month', date) as month,
  type,
  COUNT(*) as transaction_count,
  SUM(amount) as total_amount,
  AVG(amount) as average_amount,
  MAX(amount) as max_amount,
  MIN(amount) as min_amount
FROM transactions
GROUP BY business_id, DATE_TRUNC('month', date), type;

CREATE OR REPLACE VIEW business_health_metrics AS
SELECT 
  bp.id as business_id,
  bp.name as business_name,
  COUNT(t.id) as total_transactions,
  SUM(CASE WHEN t.type = 'received' THEN t.amount ELSE 0 END) as total_revenue,
  SUM(CASE WHEN t.type IN ('sent', 'paybill', 'buy_goods') THEN t.amount ELSE 0 END) as total_expenses,
  COUNT(CASE WHEN ad.requires_immediate_attention THEN 1 END) as high_risk_anomalies,
  AVG(t.confidence_score) as avg_confidence_score
FROM business_profiles bp
LEFT JOIN transactions t ON bp.id = t.business_id
LEFT JOIN anomaly_detections ad ON t.id = ad.transaction_id
WHERE t.created_at >= NOW() - INTERVAL '30 days'
GROUP BY bp.id, bp.name;

-- 14. Function to get business insights
CREATE OR REPLACE FUNCTION get_business_insights(
  p_business_id UUID,
  p_days INTEGER DEFAULT 30
)
RETURNS TABLE (
  metric_name TEXT,
  metric_value NUMERIC,
  metric_unit TEXT,
  trend TEXT
) AS $
DECLARE
  total_revenue NUMERIC;
  total_expenses NUMERIC;
  transaction_count INTEGER;
  avg_transaction NUMERIC;
  revenue_growth NUMERIC;
BEGIN
  -- Calculate current period metrics
  SELECT 
    COALESCE(SUM(CASE WHEN type = 'received' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN type IN ('sent', 'paybill', 'buy_goods') THEN amount ELSE 0 END), 0),
    COUNT(*),
    COALESCE(AVG(amount), 0)
  INTO total_revenue, total_expenses, transaction_count, avg_transaction
  FROM transactions 
  WHERE business_id = p_business_id 
    AND date >= CURRENT_DATE - INTERVAL '1 day' * p_days;

  -- Calculate revenue growth (comparing to previous period)
  WITH previous_revenue AS (
    SELECT COALESCE(SUM(amount), 0) as prev_revenue
    FROM transactions 
    WHERE business_id = p_business_id 
      AND type = 'received'
      AND date >= CURRENT_DATE - INTERVAL '1 day' * (p_days * 2)
      AND date < CURRENT_DATE - INTERVAL '1 day' * p_days
  )
  SELECT 
    CASE 
      WHEN prev_revenue > 0 THEN ((total_revenue - prev_revenue) / prev_revenue) * 100
      ELSE 0 
    END
  INTO revenue_growth
  FROM previous_revenue;

  -- Return insights
  RETURN QUERY VALUES
    ('Total Revenue', total_revenue, 'KES', CASE WHEN revenue_growth > 0 THEN 'growing' ELSE 'declining' END),
    ('Total Expenses', total_expenses, 'KES', 'neutral'),
    ('Net Profit', total_revenue - total_expenses, 'KES', 'neutral'),
    ('Transaction Count', transaction_count::NUMERIC, 'transactions', 'neutral'),
    ('Average Transaction', avg_transaction, 'KES', 'neutral'),
    ('Revenue Growth', revenue_growth, 'percent', CASE WHEN revenue_growth > 10 THEN 'positive' WHEN revenue_growth < -10 THEN 'negative' ELSE 'stable' END);
END;
$ LANGUAGE plpgsql;
