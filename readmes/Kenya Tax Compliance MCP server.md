Key Features
🇰🇪 Kenya-Specific Tax Compliance:

VAT Returns - 16% standard rate, automatic calculations
PAYE Returns - Progressive tax bands (10%, 25%, 30%), personal relief, NSSF, NHIF, Housing Levy
Withholding Tax - Different rates for various services (5%-15%)
KRA PIN validation - Proper 11-character format validation
Compliance certificates - Eligibility checking

🧮 Advanced Tax Calculations:

Accurate PAYE calculation with all deductions
NSSF (6% up to KES 18,000 ceiling)
NHIF (KES 150-1,700 based on salary bands)
Housing Levy (1.5% of gross salary)
Real Kenya tax rates and thresholds

📊 Comprehensive Reporting:

Tax obligation tracking
Compliance status reports
Detailed tax reports (summary, detailed, compliance)
Payment status updates
KRA rates lookup

Database Schema Required
sql-- Taxpayers table
CREATE TABLE taxpayers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name TEXT NOT NULL,
  kra_pin TEXT NOT NULL UNIQUE,
  vat_number TEXT,
  business_type TEXT CHECK (business_type IN ('individual', 'partnership', 'company', 'trust', 'cooperative')),
  tax_obligations TEXT[],
  registration_date DATE,
  contact_email TEXT,
  contact_phone TEXT,
  physical_address TEXT,
  postal_address TEXT,
  business_sector TEXT,
  annual_turnover DECIMAL(15,2),
  is_vat_registered BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- VAT Returns table
CREATE TABLE vat_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  taxpayer_id UUID REFERENCES taxpayers(id),
  period_month INTEGER CHECK (period_month >= 1 AND period_month <= 12),
  period_year INTEGER,
  taxable_supplies DECIMAL(15,2),
  vat_on_supplies DECIMAL(15,2),
  taxable_purchases DECIMAL(15,2),
  vat_on_purchases DECIMAL(15,2),
  imported_services DECIMAL(15,2),
  vat_on_imported_services DECIMAL(15,2),
  net_vat_due DECIMAL(15,2),
  penalties DECIMAL(15,2) DEFAULT 0,
  interest DECIMAL(15,2) DEFAULT 0,
  total_due DECIMAL(15,2),
  filing_date TIMESTAMPTZ,
  due_date DATE,
  status TEXT CHECK (status IN ('draft', 'filed', 'paid', 'overdue')),
  kra_receipt_number TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- PAYE Returns table
CREATE TABLE paye_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  taxpayer_id UUID REFERENCES taxpayers(id),
  period_month INTEGER CHECK (period_month >= 1 AND period_month <= 12),
  period_year INTEGER,
  total_employees INTEGER,
  total_gross_pay DECIMAL(15,2),
  total_paye_deducted DECIMAL(15,2),
  total_nhif_deducted DECIMAL(15,2),
  total_nssf_deducted DECIMAL(15,2),
  total_housing_levy DECIMAL(15,2),
  total_affordable_housing_levy DECIMAL(15,2),
  net_paye_due DECIMAL(15,2),
  penalties DECIMAL(15,2) DEFAULT 0,
  interest DECIMAL(15,2) DEFAULT 0,
  total_due DECIMAL(15,2),
  filing_date TIMESTAMPTZ,
  due_date DATE,
  status TEXT CHECK (status IN ('draft', 'filed', 'paid', 'overdue')),
  p9_forms JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Withholding Tax table
CREATE TABLE withholding_tax (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  taxpayer_id UUID REFERENCES taxpayers(id),
  period_month INTEGER,
  period_year INTEGER,
  supplier_pin TEXT,
  supplier_name TEXT,
  invoice_amount DECIMAL(15,2),
  wht_rate DECIMAL(5,4),
  wht_amount DECIMAL(15,2),
  service_type TEXT CHECK (service_type IN ('consultancy', 'professional', 'management', 'technical', 'rental', 'commission', 'other')),
  payment_date DATE,
  filing_date TIMESTAMPTZ,
  status TEXT CHECK (status IN ('draft', 'filed', 'paid')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tax Obligations table
CREATE TABLE tax_obligations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  taxpayer_id UUID REFERENCES taxpayers(id),
  obligation_type TEXT CHECK (obligation_type IN ('VAT', 'PAYE', 'WHT', 'CORPORATION_TAX', 'TURNOVER_TAX', 'ADVANCE_TAX')),
  period_start DATE,
  period_end DATE,
  due_date DATE,
  amount_due DECIMAL(15,2),
  amount_paid DECIMAL(15,2) DEFAULT 0,
  status TEXT CHECK (status IN ('pending', 'filed', 'paid', 'overdue', 'defaulted')),
  penalties DECIMAL(15,2) DEFAULT 0,
  interest DECIMAL(15,2) DEFAULT 0,
  compliance_certificate_valid BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
Available Tools

register_taxpayer - Register new taxpayers with KRA details
file_vat_return - File VAT returns with automatic calculations
file_paye_return - File PAYE returns with employee details and P9 forms
file_withholding_tax - File WHT for supplier payments
get_tax_obligations - View all tax obligations and deadlines
calculate_tax_liability - Calculate PAYE, VAT, or WHT
check_compliance_status - Check compliance and certificate eligibility
get_kra_rates - Get current Kenya tax rates
generate_tax_report - Generate comprehensive tax reports
update_payment_status - Update payment status with KRA receipts
list_taxpayers - List registered taxpayers with filtering
SME-Friendly Tools:

estimate_monthly_taxes - Quick tax planning for cash flow
sync_payments_to_tax - Match M-Pesa payments to tax obligations
check_vat_registration_requirement - Smart VAT threshold checking
generate_tax_calendar - Personalized tax calendar with reminders
simulate_tax_scenarios - What-if analysis for business planning

2. Enhanced Compliance:

get_compliance_score - 0-100 scoring with improvement tips
queue_kra_submission - Offline-first KRA submission queue
Automatic penalty calculations
Enhanced audit trail logging

3. Production-Ready Features:

Robust KRA PIN validation with user-friendly error messages
Weekend/holiday adjustment for tax deadlines
Automatic penalty calculation based on KRA rates
Comprehensive audit logging for compliance
Enhanced error handling throughout

4. Perfect Integration with Finji:

Cash flow impact analysis for tax planning
Payment sync from M-Pesa transactions
WhatsApp-ready responses with clear action items
Real-time compliance monitoring

🚀 Ready for Production:
The enhanced MCP server is now production-ready for your Finji platform with:

✅ All SME pain points addressed
✅ Kenya-specific tax calculations
✅ Offline-first approach for unreliable internet
✅ User-friendly English responses
✅ Complete integration hooks for M-Pesa and WhatsApp
✅ Comprehensive compliance tracking

This will seamlessly integrate with your existing Finji ecosystem and make tax compliance as simple as sending a WhatsApp message! 🎉
