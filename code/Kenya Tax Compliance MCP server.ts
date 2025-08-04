// Enhanced Supabase Edge Function for Kenya Tax Compliance MCP Server
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Enhanced Types for Kenya Tax System
interface TaxPayer {
  id: string;
  business_name: string;
  kra_pin: string;
  vat_number?: string;
  business_type: 'individual' | 'partnership' | 'company' | 'trust' | 'cooperative';
  tax_obligations: string[];
  registration_date: string;
  contact_email: string;
  contact_phone: string;
  physical_address: string;
  postal_address: string;
  business_sector: string;
  annual_turnover?: number;
  is_vat_registered: boolean;
  created_at: string;
}

interface VATReturn {
  id: string;
  taxpayer_id: string;
  period_month: number;
  period_year: number;
  taxable_supplies: number;
  vat_on_supplies: number;
  taxable_purchases: number;
  vat_on_purchases: number;
  imported_services: number;
  vat_on_imported_services: number;
  net_vat_due: number;
  penalties: number;
  interest: number;
  total_due: number;
  filing_date: string;
  due_date: string;
  status: 'draft' | 'filed' | 'paid' | 'overdue';
  kra_receipt_number?: string;
  auto_penalties_calculated: boolean;
  created_at: string;
  updated_at: string;
}

interface PAYEReturn {
  id: string;
  taxpayer_id: string;
  period_month: number;
  period_year: number;
  total_employees: number;
  total_gross_pay: number;
  total_paye_deducted: number;
  total_nhif_deducted: number;
  total_nssf_deducted: number;
  total_housing_levy: number;
  total_affordable_housing_levy: number;
  net_paye_due: number;
  penalties: number;
  interest: number;
  total_due: number;
  filing_date: string;
  due_date: string;
  status: 'draft' | 'filed' | 'paid' | 'overdue';
  p9_forms: EmployeeP9[];
  auto_penalties_calculated: boolean;
  created_at: string;
  updated_at: string;
}

interface EmployeeP9 {
  employee_kra_pin: string;
  employee_name: string;
  basic_salary: number;
  allowances: number;
  gross_pay: number;
  nssf_deduction: number;
  pension_contribution: number;
  owner_occupier_interest: number;
  insurance_relief: number;
  taxable_income: number;
  paye_tax: number;
  nhif_deduction: number;
  housing_levy: number;
  net_pay: number;
}

interface WithholdingTax {
  id: string;
  taxpayer_id: string;
  period_month: number;
  period_year: number;
  supplier_pin: string;
  supplier_name: string;
  invoice_amount: number;
  wht_rate: number;
  wht_amount: number;
  service_type: 'consultancy' | 'professional' | 'management' | 'technical' | 'rental' | 'commission' | 'other';
  payment_date: string;
  filing_date: string;
  status: 'draft' | 'filed' | 'paid';
  created_at: string;
}

interface TaxObligation {
  id: string;
  taxpayer_id: string;
  obligation_type: 'VAT' | 'PAYE' | 'WHT' | 'CORPORATION_TAX' | 'TURNOVER_TAX' | 'ADVANCE_TAX';
  period_start: string;
  period_end: string;
  due_date: string;
  amount_due: number;
  amount_paid: number;
  status: 'pending' | 'filed' | 'paid' | 'overdue' | 'defaulted';
  penalties: number;
  interest: number;
  compliance_certificate_valid: boolean;
  auto_calculated_penalties: boolean;
  created_at: string;
  updated_at: string;
}

// NEW: KRA Submission Queue for offline-first approach
interface KRASubmissionQueue {
  id: string;
  taxpayer_id: string;
  return_type: 'VAT' | 'PAYE' | 'WHT' | 'CORPORATION_TAX';
  return_data: any;
  submission_status: 'pending' | 'submitted' | 'failed' | 'rejected';
  retry_count: number;
  last_attempt: string;
  error_message?: string;
  kra_reference?: string;
  created_at: string;
  updated_at: string;
}

// NEW: Tax Audit Log for compliance tracking
interface TaxAuditLog {
  id: string;
  taxpayer_id: string;
  action: string;
  entity_type: 'VAT_RETURN' | 'PAYE_RETURN' | 'WHT' | 'OBLIGATION' | 'TAXPAYER';
  entity_id: string;
  user_id?: string;
  before_data?: any;
  after_data?: any;
  timestamp: string;
  ip_address?: string;
  user_agent?: string;
  notes?: string;
}

// NEW: Compliance Score tracking
interface ComplianceScore {
  id: string;
  taxpayer_id: string;
  score: number; // 0-100
  risk_level: 'low' | 'medium' | 'high' | 'critical';
  factors: {
    timely_filing: number;
    payment_history: number;
    accuracy: number;
    completeness: number;
  };
  improvement_tips: string[];
  certificate_eligibility: boolean;
  last_calculated: string;
  created_at: string;
  updated_at: string;
}

// NEW: Monthly Tax Estimate
interface MonthlyTaxEstimate {
  vat_estimate: number;
  paye_estimate: number;
  wht_estimate: number;
  total_estimate: number;
  cash_flow_impact: number;
  recommendations: string[];
  confidence_level: 'high' | 'medium' | 'low';
}

// Initialize Supabase client
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const supabase = createClient(supabaseUrl, supabaseKey);

// Enhanced Kenya Tax Constants with KRA holidays
const KENYA_TAX_RATES = {
  VAT_STANDARD: 0.16,
  VAT_ZERO: 0.0,
  VAT_EXEMPT: null,
  PAYE_PERSONAL_RELIEF: 2400,
  INSURANCE_RELIEF_MAX: 5000,
  NSSF_RATE: 0.06,
  NHIF_MAX: 1700,
  HOUSING_LEVY_RATE: 0.015,
  AFFORDABLE_HOUSING_LEVY_RATE: 0.015,
  PENALTY_RATE: 0.05, // 5% penalty
  INTEREST_RATE_PER_DAY: 0.01, // 1% per day
  WHT_RATES: {
    consultancy: 0.05,
    professional: 0.05,
    management: 0.05,
    technical: 0.05,
    rental: 0.10,
    commission: 0.05,
    dividend: 0.05,
    interest: 0.15,
    royalty: 0.05
  }
};

const PAYE_TAX_BANDS = [
  { min: 0, max: 24000, rate: 0.10 },
  { min: 24001, max: 32333, rate: 0.25 },
  { min: 32334, max: Infinity, rate: 0.30 }
];

// KRA Public Holidays (for deadline calculations)
const KRA_HOLIDAYS_2025 = [
  '2025-01-01', // New Year
  '2025-04-18', // Good Friday
  '2025-04-21', // Easter Monday
  '2025-05-01', // Labour Day
  '2025-06-01', // Madaraka Day
  '2025-10-20', // Mashujaa Day
  '2025-12-12', // Jamhuri Day
  '2025-12-25', // Christmas
  '2025-12-26'  // Boxing Day
];

// Enhanced Utility Functions
function generateId(): string {
  return crypto.randomUUID();
}

function validateKRAPIN(pin: string): { valid: boolean; error?: string } {
  const kraRegex = /^[A-Z]\d{9}[A-Z]$/;
  if (!kraRegex.test(pin)) {
    return {
      valid: false,
      error: "KRA PIN yapotea! Lazima iwe kama hii: A123456789B (herufi, nambari 9, herufi)"
    };
  }
  return { valid: true };
}

function daysBetween(date1: string, date2: string): number {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  const diffTime = Math.abs(d2.getTime() - d1.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6; // Sunday or Saturday
}

function isKRAHoliday(date: Date): boolean {
  const dateStr = date.toISOString().split('T')[0];
  return KRA_HOLIDAYS_2025.includes(dateStr);
}

function adjustForWeekends(date: Date): Date {
  let adjusted = new Date(date);
  
  // If falls on weekend or holiday, move to next business day
  while (isWeekend(adjusted) || isKRAHoliday(adjusted)) {
    adjusted.setDate(adjusted.getDate() + 1);
  }
  
  return adjusted;
}

function getKRADeadline(taxType: string, period: Date): Date {
  const deadline = new Date(period);
  deadline.setMonth(deadline.getMonth() + 1);
  
  switch (taxType) {
    case 'VAT':
    case 'PAYE':
    case 'WHT':
      deadline.setDate(20); // Due 20th of following month
      break;
    case 'CORPORATION_TAX':
      deadline.setMonth(deadline.getMonth() + 5); // 6 months after year end
      deadline.setDate(30);
      break;
    default:
      deadline.setDate(20);
  }
  
  return adjustForWeekends(deadline);
}

function calculatePenalties(dueDate: string, currentDate: string, amount: number): { penalties: number; interest: number } {
  const daysLate = daysBetween(dueDate, currentDate);
  let penalties = 0;
  let interest = 0;
  
  if (daysLate > 0) {
    // KRA penalty structure: 5% penalty + 1% per day interest
    penalties = amount * KENYA_TAX_RATES.PENALTY_RATE;
    interest = amount * (daysLate * KENYA_TAX_RATES.INTEREST_RATE_PER_DAY);
  }
  
  return { penalties, interest };
}

function calculateComplianceScore(taxpayer: any, obligations: any[], returns: any[]): ComplianceScore {
  const currentDate = new Date();
  const lastYear = new Date(currentDate);
  lastYear.setFullYear(lastYear.getFullYear() - 1);
  
  // Calculate factors
  const recentObligations = obligations.filter(o => new Date(o.created_at) >= lastYear);
  const timelyFiled = recentObligations.filter(o => 
    o.status === 'filed' || o.status === 'paid'
  ).length;
  
  const timelyFilingScore = recentObligations.length > 0 ? 
    (timelyFiled / recentObligations.length) * 100 : 100;
  
  const overdueCount = obligations.filter(o => 
    new Date(o.due_date) < currentDate && o.status !== 'paid'
  ).length;
  
  const paymentHistoryScore = Math.max(0, 100 - (overdueCount * 10));
  
  // Simple accuracy and completeness scores (can be enhanced with actual data)
  const accuracyScore = 90; // Placeholder
  const completenessScore = 85; // Placeholder
  
  const overallScore = Math.round(
    (timelyFilingScore * 0.3) + 
    (paymentHistoryScore * 0.4) + 
    (accuracyScore * 0.15) + 
    (completenessScore * 0.15)
  );
  
  let riskLevel: 'low' | 'medium' | 'high' | 'critical';
  if (overallScore >= 80) riskLevel = 'low';
  else if (overallScore >= 60) riskLevel = 'medium';
  else if (overallScore >= 40) riskLevel = 'high';
  else riskLevel = 'critical';
  
  const tips = [];
  if (timelyFilingScore < 80) tips.push("File returns on time to improve your score");
  if (paymentHistoryScore < 80) tips.push("Pay taxes before due dates");
  if (overdueCount > 0) tips.push("Clear all overdue obligations immediately");
  if (overallScore < 60) tips.push("Consider setting up payment reminders");
  
  return {
    id: generateId(),
    taxpayer_id: taxpayer.id,
    score: overallScore,
    risk_level: riskLevel,
    factors: {
      timely_filing: timelyFilingScore,
      payment_history: paymentHistoryScore,
      accuracy: accuracyScore,
      completeness: completenessScore
    },
    improvement_tips: tips,
    certificate_eligibility: overallScore >= 80 && overdueCount === 0,
    last_calculated: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

async function logAuditTrail(action: string, taxpayerId: string, entityType: string, entityId: string, beforeData?: any, afterData?: any, userId?: string): Promise<void> {
  const auditLog: TaxAuditLog = {
    id: generateId(),
    taxpayer_id: taxpayerId,
    action,
    entity_type: entityType as any,
    entity_id: entityId,
    user_id: userId,
    before_data: beforeData,
    after_data: afterData,
    timestamp: new Date().toISOString(),
    ip_address: undefined, // Can be extracted from request headers
    user_agent: undefined,
    notes: undefined
  };
  
  await supabase.from('tax_audit_logs').insert([auditLog]);
}

function calculatePAYE(grossPay: number, nssfDeduction: number, pensionContribution: number = 0, insuranceRelief: number = 0): number {
  const taxableIncome = Math.max(0, grossPay - nssfDeduction - pensionContribution - KENYA_TAX_RATES.PAYE_PERSONAL_RELIEF - Math.min(insuranceRelief, KENYA_TAX_RATES.INSURANCE_RELIEF_MAX));
  
  let paye = 0;
  for (const band of PAYE_TAX_BANDS) {
    if (taxableIncome > band.min) {
      const taxableAtBand = Math.min(taxableIncome, band.max) - band.min + 1;
      paye += taxableAtBand * band.rate;
    }
  }
  
  return Math.round(paye);
}

function calculateNSSF(grossPay: number): number {
  const pensionablePay = Math.min(grossPay, 18000); // NSSF ceiling
  return Math.round(pensionablePay * KENYA_TAX_RATES.NSSF_RATE);
}

function calculateNHIF(grossPay: number): number {
  const nhifBands = [
    { min: 0, max: 5999, amount: 150 },
    { min: 6000, max: 7999, amount: 300 },
    { min: 8000, max: 11999, amount: 400 },
    { min: 12000, max: 14999, amount: 500 },
    { min: 15000, max: 19999, amount: 600 },
    { min: 20000, max: 24999, amount: 750 },
    { min: 25000, max: 29999, amount: 850 },
    { min: 30000, max: 34999, amount: 900 },
    { min: 35000, max: 39999, amount: 950 },
    { min: 40000, max: 44999, amount: 1000 },
    { min: 45000, max: 49999, amount: 1100 },
    { min: 50000, max: 59999, amount: 1200 },
    { min: 60000, max: 69999, amount: 1300 },
    { min: 70000, max: 79999, amount: 1400 },
    { min: 80000, max: 89999, amount: 1500 },
    { min: 90000, max: 99999, amount: 1600 },
    { min: 100000, max: Infinity, amount: 1700 }
  ];
  
  for (const band of nhifBands) {
    if (grossPay >= band.min && grossPay <= band.max) {
      return band.amount;
    }
  }
  return 0;
}

function calculateHousingLevy(grossPay: number): number {
  return Math.round(grossPay * KENYA_TAX_RATES.HOUSING_LEVY_RATE);
}

function calculateNextDueDate(obligationType: string, currentDate: Date): string {
  return getKRADeadline(obligationType, currentDate).toISOString().split('T')[0];
}

// Enhanced MCP Tools
const tools = [
  // Existing tools...
  {
    name: "register_taxpayer",
    description: "Register a new taxpayer with KRA details",
    inputSchema: {
      type: "object",
      properties: {
        business_name: { type: "string", description: "Business/Individual name" },
        kra_pin: { type: "string", description: "KRA PIN (11 characters)" },
        vat_number: { type: "string", description: "VAT number if VAT registered" },
        business_type: { 
          type: "string", 
          enum: ["individual", "partnership", "company", "trust", "cooperative"],
          description: "Type of business entity" 
        },
        tax_obligations: { 
          type: "array", 
          items: { type: "string" },
          description: "List of tax obligations (VAT, PAYE, etc.)" 
        },
        contact_email: { type: "string", description: "Contact email" },
        contact_phone: { type: "string", description: "Contact phone" },
        physical_address: { type: "string", description: "Physical address" },
        postal_address: { type: "string", description: "Postal address" },
        business_sector: { type: "string", description: "Business sector/industry" },
        annual_turnover: { type: "number", description: "Annual turnover (optional)" },
        is_vat_registered: { type: "boolean", description: "VAT registration status" }
      },
      required: ["business_name", "kra_pin", "business_type", "tax_obligations", "contact_email", "contact_phone", "physical_address", "postal_address", "business_sector", "is_vat_registered"]
    }
  },

  // NEW: Monthly Tax Estimation Tool
  {
    name: "estimate_monthly_taxes",
    description: "Quick tax estimate for monthly planning - perfect for SME cash flow management",
    inputSchema: {
      type: "object",
      properties: {
        monthly_revenue: { type: "number", description: "Expected monthly revenue" },
        monthly_expenses: { type: "number", description: "Expected monthly expenses" },
        employee_count: { type: "number", description: "Number of employees" },
        average_salary: { type: "number", description: "Average employee salary" },
        business_type: { 
          type: "string", 
          enum: ["individual", "partnership", "company", "trust", "cooperative"],
          description: "Business type for tax calculations" 
        },
        is_vat_registered: { type: "boolean", description: "VAT registration status" },
        has_rental_income: { type: "boolean", description: "Has rental income" },
        consultant_payments: { type: "number", description: "Monthly payments to consultants", default: 0 }
      },
      required: ["monthly_revenue", "monthly_expenses", "employee_count", "business_type", "is_vat_registered"]
    }
  },

  // NEW: Sync M-Pesa payments to tax obligations
  {
    name: "sync_payments_to_tax",
    description: "Match M-Pesa/bank payments to tax obligations automatically",
    inputSchema: {
      type: "object",
      properties: {
        taxpayer_id: { type: "string", description: "Taxpayer ID" },
        payment_data: {
          type: "array",
          description: "Payment transactions from M-Pesa/bank",
          items: {
            type: "object",
            properties: {
              transaction_id: { type: "string", description: "Transaction ID" },
              amount: { type: "number", description: "Payment amount" },
              date: { type: "string", description: "Payment date" },
              recipient: { type: "string", description: "Payment recipient" },
              description: { type: "string", description: "Payment description" }
            }
          }
        },
        auto_match: { type: "boolean", description: "Automatically match payments", default: true }
      },
      required: ["taxpayer_id", "payment_data"]
    }
  },

  // NEW: Enhanced compliance status with scoring
  {
    name: "get_compliance_score",
    description: "Get detailed compliance score and improvement recommendations",
    inputSchema: {
      type: "object",
      properties: {
        taxpayer_id: { type: "string", description: "Taxpayer ID" },
        recalculate: { type: "boolean", description: "Force recalculation of score", default: false }
      },
      required: ["taxpayer_id"]
    }
  },

  // NEW: Automatic penalty calculation
  {
    name: "calculate_auto_penalties",
    description: "Calculate and update penalties for overdue obligations",
    inputSchema: {
      type: "object",
      properties: {
        taxpayer_id: { type: "string", description: "Taxpayer ID" },
        obligation_id: { type: "string", description: "Specific obligation ID (optional)" },
        apply_penalties: { type: "boolean", description: "Apply calculated penalties", default: false }
      },
      required: ["taxpayer_id"]
    }
  },

  // NEW: KRA submission queue management
  {
    name: "queue_kra_submission",
    description: "Queue tax return for KRA submission with retry logic",
    inputSchema: {
      type: "object",
      properties: {
        taxpayer_id: { type: "string", description: "Taxpayer ID" },
        return_type: { 
          type: "string", 
          enum: ["VAT", "PAYE", "WHT", "CORPORATION_TAX"],
          description: "Type of return to submit" 
        },
        return_id: { type: "string", description: "Return ID to submit" },
        priority: { 
          type: "string", 
          enum: ["low", "normal", "high", "urgent"],
          description: "Submission priority",
          default: "normal"
        }
      },
      required: ["taxpayer_id", "return_type", "return_id"]
    }
  },

  // NEW: Smart deadline reminders
  {
    name: "get_upcoming_deadlines",
    description: "Get upcoming tax deadlines with smart reminders",
    inputSchema: {
      type: "object",
      properties: {
        taxpayer_id: { type: "string", description: "Taxpayer ID" },
        days_ahead: { type: "number", description: "Days to look ahead", default: 30 },
        include_estimates: { type: "boolean", description: "Include estimated amounts", default: true }
      },
      required: ["taxpayer_id"]
    }
  },

  // Enhanced existing tools with better error handling...
  {
    name: "file_vat_return",
    description: "File a VAT return for a specific period with auto penalty calculation",
    inputSchema: {
      type: "object",
      properties: {
        taxpayer_id: { type: "string", description: "Taxpayer ID" },
        period_month: { type: "number", description: "Month (1-12)" },
        period_year: { type: "number", description: "Year" },
        taxable_supplies: { type: "number", description: "Total taxable supplies" },
        taxable_purchases: { type: "number", description: "Total taxable purchases" },
        imported_services: { type: "number", description: "Imported services value", default: 0 },
        auto_calculate_penalties: { type: "boolean", description: "Auto calculate penalties if late", default: true }
      },
      required: ["taxpayer_id", "period_month", "period_year", "taxable_supplies", "taxable_purchases"]
    }
  },

  {
    name: "file_paye_return",
    description: "File a PAYE return with employee details and auto penalty calculation",
    inputSchema: {
      type: "object",
      properties: {
        taxpayer_id: { type: "string", description: "Taxpayer ID" },
        period_month: { type: "number", description: "Month (1-12)" },
        period_year: { type: "number", description: "Year" },
        employees: {
          type: "array",
          description: "Employee payroll details",
          items: {
            type: "object",
            properties: {
              employee_kra_pin: { type: "string", description: "Employee KRA PIN" },
              employee_name: { type: "string", description: "Employee name" },
              basic_salary: { type: "number", description: "Basic salary" },
              allowances: { type: "number", description: "Total allowances" },
              pension_contribution: { type: "number", description: "Pension contribution", default: 0 },
              insurance_relief: { type: "number", description: "Insurance relief", default: 0 }
            },
            required: ["employee_kra_pin", "employee_name", "basic_salary", "allowances"]
          }
        },
        auto_calculate_penalties: { type: "boolean", description: "Auto calculate penalties if late", default: true }
      },
      required: ["taxpayer_id", "period_month", "period_year", "employees"]
    }
  },

  {
    name: "file_withholding_tax",
    description: "File withholding tax for payments to suppliers",
    inputSchema: {
      type: "object",
      properties: {
        taxpayer_id: { type: "string", description: "Taxpayer ID" },
        period_month: { type: "number", description: "Month (1-12)" },
        period_year: { type: "number", description: "Year" },
        supplier_pin: { type: "string", description: "Supplier KRA PIN" },
        supplier_name: { type: "string", description: "Supplier name" },
        invoice_amount: { type: "number", description: "Invoice amount" },
        service_type: { 
          type: "string", 
          enum: ["consultancy", "professional", "management", "technical", "rental", "commission", "other"],
          description: "Type of service" 
        },
        payment_date: { type: "string", description: "Payment date (YYYY-MM-DD)" }
      },
      required: ["taxpayer_id", "period_month", "period_year", "supplier_pin", "supplier_name", "invoice_amount", "service_type", "payment_date"]
    }
  },

  {
    name: "get_tax_obligations",
    description: "Get all tax obligations for a taxpayer",
    inputSchema: {
      type: "object",
      properties: {
        taxpayer_id: { type: "string", description: "Taxpayer ID" },
        status: { 
          type: "string", 
          enum: ["pending", "filed", "paid", "overdue", "defaulted"],
          description: "Filter by obligation status (optional)" 
        }
      },
      required: ["taxpayer_id"]
    }
  },

  {
    name: "calculate_tax_liability",
    description: "Calculate tax liability for different tax types",
    inputSchema: {
      type: "object",
      properties: {
        tax_type: { 
          type: "string", 
          enum: ["PAYE", "VAT", "WHT"],
          description: "Type of tax to calculate" 
        },
        amount: { type: "number", description: "Base amount for calculation" },
        additional_params: { 
          type: "object", 
          description: "Additional parameters (NSSF, allowances, etc.)" 
        }
      },
      required: ["tax_type", "amount"]
    }
  },

  {
    name: "check_compliance_status",
    description: "Check compliance status and generate compliance certificate eligibility",
    inputSchema: {
      type: "object",
      properties: {
        taxpayer_id: { type: "string", description: "Taxpayer ID" }
      },
      required: ["taxpayer_id"]
    }
  },

  {
    name: "get_kra_rates",
    description: "Get current KRA tax rates and thresholds",
    inputSchema: {
      type: "object",
      properties: {
        rate_type: { 
          type: "string", 
          enum: ["all", "VAT", "PAYE", "WHT", "NHIF", "NSSF"],
          description: "Specific rate type or 'all' for all rates" 
        }
      }
    }
  },

  {
    name: "generate_tax_report",
    description: "Generate comprehensive tax report for a period",
    inputSchema: {
      type: "object",
      properties: {
        taxpayer_id: { type: "string", description: "Taxpayer ID" },
        period_start: { type: "string", description: "Period start date (YYYY-MM-DD)" },
        period_end: { type: "string", description: "Period end date (YYYY-MM-DD)" },
        report_type: { 
          type: "string", 
          enum: ["summary", "detailed", "compliance"],
          description: "Type of report to generate" 
        }
      },
      required: ["taxpayer_id", "period_start", "period_end", "report_type"]
    }
  },

  {
    name: "update_payment_status",
    description: "Update payment status for tax obligations",
    inputSchema: {
      type: "object",
      properties: {
        obligation_id: { type: "string", description: "Tax obligation ID" },
        amount_paid: { type: "number", description: "Amount paid" },
        payment_date: { type: "string", description: "Payment date (YYYY-MM-DD)" },
        kra_receipt_number: { type: "string", description: "KRA receipt number" }
      },
      required: ["obligation_id", "amount_paid", "payment_date"]
    }
  },

  {
    name: "list_taxpayers",
    description: "List all registered taxpayers with optional filtering",
    inputSchema: {
      type: "object",
      properties: {
        business_type: { 
          type: "string", 
          enum: ["individual", "partnership", "company", "trust", "cooperative"],
          description: "Filter by business type (optional)" 
        },
        vat_registered: { type: "boolean", description: "Filter by VAT registration status (optional)" }
      }
    }
  }
];

// Enhanced Tool Handlers with better error handling and new features
async function handleTool(name: string, args: any): Promise<any> {
  try {
    switch (name) {
      case "register_taxpayer": {
        // Enhanced KRA PIN validation with user-friendly messages
        const pinValidation = validateKRAPIN(args.kra_pin);
        if (!pinValidation.valid) {
          return {
            content: [
              {
                type: "text",
                text: `❌ ${pinValidation.error}\n\nMfano sahihi: A123456789B\n- Herufi ya kwanza (A-Z)\n- Nambari 9 (0-9)\n- Herufi ya mwisho (A-Z)`
              }
            ],
            isError: true
          };
        }

        const taxpayer: TaxPayer = {
          id: generateId(),
          business_name: args.business_name,
          kra_pin: args.kra_pin.toUpperCase(),
          vat_number: args.vat_number?.toUpperCase() || null,
          business_type: args.business_type,
          tax_obligations: args.tax_obligations,
          registration_date: new Date().toISOString().split('T')[0],
          contact_email: args.contact_email,
          contact_phone: args.contact_phone,
          physical_address: args.physical_address,
          postal_address: args.postal_address,
          business_sector: args.business_sector,
          annual_turnover: args.annual_turnover || null,
          is_vat_registered: args.is_vat_registered,
          created_at: new Date().toISOString()
        };

        const { data, error } = await supabase
          .from('taxpayers')
          .insert([taxpayer])
          .select()
          .single();
        
        if (error) {
          if (error.code === '23505') { // Unique constraint violation
            return {
              content: [
                {
                  type: "text",
                  text: `❌ KRA PIN ${args.kra_pin} tayari imejiandikisha. Tumia KRA PIN tofauti au angalia kama umesha jiandikisha.`
                }
              ],
              isError: true
            };
          }
          throw error;
        }

        // Create initial tax obligations
        const obligations = [];
        const currentDate = new Date();
        
        for (const obligationType of args.tax_obligations) {
          obligations.push({
            id: generateId(),
            taxpayer_id: data.id,
            obligation_type: obligationType,
            period_start: currentDate.toISOString().split('T')[0],
            period_end: calculateNextDueDate(obligationType, currentDate),
            due_date: calculateNextDueDate(obligationType, currentDate),
            amount_due: 0,
            amount_paid: 0,
            status: 'pending',
            penalties: 0,
            interest: 0,
            compliance_certificate_valid: true,
            auto_calculated_penalties: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          });
        }

        if (obligations.length > 0) {
          await supabase.from('tax_obligations').insert(obligations);
        }

        // Log audit trail
        await logAuditTrail('TAXPAYER_REGISTERED', data.id, 'TAXPAYER', data.id, null, data);

        return {
          content: [
            {
              type: "text",
              text: `✅ Taxpayer registered successfully!\n\n🏢 Business: ${data.business_name}\n📄 KRA PIN: ${data.kra_pin}\n📅 Registration: ${data.registration_date}\n\n📋 Tax obligations created:\n${args.tax_obligations.map(o => `• ${o}`).join('\n')}\n\n🎯 Next steps:\n• Set up your first tax return\n• Configure payment reminders\n• Upload your business documents`
            }
          ]
        };
      }

      case "estimate_monthly_taxes": {
        const estimate: MonthlyTaxEstimate = {
          vat_estimate: 0,
          paye_estimate: 0,
          wht_estimate: 0,
          total_estimate: 0,
          cash_flow_impact: 0,
          recommendations: [],
          confidence_level: 'medium'
        };

        // VAT Calculation
        if (args.is_vat_registered) {
          const netSales = args.monthly_revenue - args.monthly_expenses;
          estimate.vat_estimate = Math.max(0, netSales * KENYA_TAX_RATES.VAT_STANDARD);
        }

        // PAYE Calculation
        if (args.employee_count > 0 && args.average_salary) {
          const totalGrossPay = args.employee_count * args.average_salary;
          const totalNSSF = args.employee_count * calculateNSSF(args.average_salary);
          
          // Simplified PAYE calculation per employee
          const payePerEmployee = calculatePAYE(args.average_salary, calculateNSSF(args.average_salary));
          estimate.paye_estimate = args.employee_count * payePerEmployee;
        }

        // WHT Calculation
        if (args.consultant_payments > 0) {
          estimate.wht_estimate = args.consultant_payments * KENYA_TAX_RATES.WHT_RATES.consultancy;
        }

        estimate.total_estimate = estimate.vat_estimate + estimate.paye_estimate + estimate.wht_estimate;
        estimate.cash_flow_impact = (estimate.total_estimate / args.monthly_revenue) * 100;

        // Generate recommendations
        if (estimate.cash_flow_impact > 30) {
          estimate.recommendations.push("💰 Tax burden is high (>30% of revenue). Consider tax planning strategies.");
          estimate.confidence_level = 'high';
        }
        
        if (args.is_vat_registered && estimate.vat_estimate < 0) {
          estimate.recommendations.push("📈 You may be eligible for VAT refund this month.");
        }
        
        if (args.employee_count > 5) {
          estimate.recommendations.push("👥 Consider automated payroll system for PAYE compliance.");
        }

        estimate.recommendations.push("📅 Set aside tax money weekly to avoid cash flow issues.");
        estimate.recommendations.push("🔔 Enable Finji reminders 5 days before tax deadlines.");

        return {
          content: [
            {
              type: "text",
              text: `📊 Monthly Tax Estimate\n\n💼 Business Overview:\n• Revenue: KES ${args.monthly_revenue.toLocaleString()}\n• Expenses: KES ${args.monthly_expenses.toLocaleString()}\n• Employees: ${args.employee_count}\n\n💰 Tax Estimates:\n• VAT: KES ${estimate.vat_estimate.toLocaleString()}\n• PAYE: KES ${estimate.paye_estimate.toLocaleString()}\n• WHT: KES ${estimate.wht_estimate.toLocaleString()}\n• TOTAL: KES ${estimate.total_estimate.toLocaleString()}\n\n📈 Cash Flow Impact: ${estimate.cash_flow_impact.toFixed(1)}% of revenue\n\n💡 Recommendations:\n${estimate.recommendations.map(r => `${r}`).join('\n')}\n\n🎯 Confidence Level: ${estimate.confidence_level.toUpperCase()}`
            }
          ]
        };
      }

      case "sync_payments_to_tax": {
        const { data: taxpayer } = await supabase
          .from('taxpayers')
          .select('*')
          .eq('id', args.taxpayer_id)
          .single();

        if (!taxpayer) {
          return {
            content: [
              {
                type: "text",
                text: "❌ Taxpayer not found. Please check the taxpayer ID."
              }
            ],
            isError: true
          };
        }

        // Get pending tax obligations
        const { data: obligations } = await supabase
          .from('tax_obligations')
          .select('*')
          .eq('taxpayer_id', args.taxpayer_id)
          .in('status', ['pending', 'filed'])
          .order('due_date', { ascending: true });

        const matchedPayments = [];
        const unmatchedPayments = [];

        // Simple matching algorithm - can be enhanced with ML
        for (const payment of args.payment_data) {
          let matched = false;
          
          // Look for KRA-related keywords in description
          const kraKeywords = ['kra', 'tax', 'vat', 'paye', 'wht', 'kenya revenue'];
          const description = payment.description.toLowerCase();
          
          if (kraKeywords.some(keyword => description.includes(keyword))) {
            // Try to match with pending obligations by amount
            const matchingObligation = obligations?.find(o => 
              Math.abs(o.amount_due - payment.amount) < 100 // Allow KES 100 variance
            );
            
            if (matchingObligation && args.auto_match) {
              // Update obligation as paid
              await supabase
                .from('tax_obligations')
                .update({
                  amount_paid: payment.amount,
                  status: 'paid',
                  updated_at: new Date().toISOString()
                })
                .eq('id', matchingObligation.id);
              
              matchedPayments.push({
                payment: payment,
                obligation: matchingObligation,
                match_confidence: 'high'
              });
              matched = true;
            }
          }
          
          if (!matched) {
            unmatchedPayments.push(payment);
          }
        }

        // Log audit trail for matched payments
        for (const match of matchedPayments) {
          await logAuditTrail(
            'PAYMENT_SYNCED', 
            args.taxpayer_id, 
            'OBLIGATION', 
            match.obligation.id,
            { amount_paid: 0 },
            { amount_paid: match.payment.amount }
          );
        }

        return {
          content: [
            {
              type: "text",
              text: `🔄 Payment Sync Results\n\n✅ Matched Payments: ${matchedPayments.length}\n${matchedPayments.map(m => `• KES ${m.payment.amount.toLocaleString()} → ${m.obligation.obligation_type} (${m.payment.date})`).join('\n')}\n\n❓ Unmatched Payments: ${unmatchedPayments.length}\n${unmatchedPayments.map(p => `• KES ${p.amount.toLocaleString()} - ${p.description} (${p.date})`).join('\n')}\n\n💡 Tip: Use keywords like 'KRA', 'VAT', 'PAYE' in M-Pesa descriptions for better matching.`
            }
          ]
        };
      }

      case "get_compliance_score": {
        const { data: taxpayer } = await supabase
          .from('taxpayers')
          .select('*')
          .eq('id', args.taxpayer_id)
          .single();

        if (!taxpayer) {
          return {
            content: [
              {
                type: "text",
                text: "❌ Taxpayer not found."
              }
            ],
            isError: true
          };
        }

        // Get existing score if not recalculating
        let complianceScore: ComplianceScore | null = null;
        
        if (!args.recalculate) {
          const { data: existingScore } = await supabase
            .from('compliance_scores')
            .select('*')
            .eq('taxpayer_id', args.taxpayer_id)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();
            
          if (existingScore && daysBetween(existingScore.last_calculated, new Date().toISOString()) < 7) {
            complianceScore = existingScore;
          }
        }

        // Recalculate if needed
        if (!complianceScore || args.recalculate) {
          const { data: obligations } = await supabase
            .from('tax_obligations')
            .select('*')
            .eq('taxpayer_id', args.taxpayer_id);

          const { data: returns } = await supabase
            .from('vat_returns')
            .select('*')
            .eq('taxpayer_id', args.taxpayer_id);

          complianceScore = calculateComplianceScore(taxpayer, obligations || [], returns || []);
          
          // Save to database
          await supabase
            .from('compliance_scores')
            .insert([complianceScore]);
        }

        const riskEmoji = {
          'low': '🟢',
          'medium': '🟡', 
          'high': '🟠',
          'critical': '🔴'
        };

        return {
          content: [
            {
              type: "text",
              text: `📊 Compliance Score Report\n\n🏢 ${taxpayer.business_name}\n📄 KRA PIN: ${taxpayer.kra_pin}\n\n🎯 Overall Score: ${complianceScore.score}/100\n${riskEmoji[complianceScore.risk_level]} Risk Level: ${complianceScore.risk_level.toUpperCase()}\n\n📈 Score Breakdown:\n• Timely Filing: ${complianceScore.factors.timely_filing.toFixed(1)}%\n• Payment History: ${complianceScore.factors.payment_history.toFixed(1)}%\n• Accuracy: ${complianceScore.factors.accuracy.toFixed(1)}%\n• Completeness: ${complianceScore.factors.completeness.toFixed(1)}%\n\n📜 Compliance Certificate: ${complianceScore.certificate_eligibility ? '✅ ELIGIBLE' : '❌ NOT ELIGIBLE'}\n\n💡 Improvement Tips:\n${complianceScore.improvement_tips.map(tip => `• ${tip}`).join('\n')}\n\n📅 Last Updated: ${new Date(complianceScore.last_calculated).toLocaleDateString()}`
            }
          ]
        };
      }

      case "calculate_auto_penalties": {
        const currentDate = new Date().toISOString().split('T')[0];
        
        let query = supabase
          .from('tax_obligations')
          .select('*')
          .eq('taxpayer_id', args.taxpayer_id)
          .lt('due_date', currentDate)
          .neq('status', 'paid');

        if (args.obligation_id) {
          query = query.eq('id', args.obligation_id);
        }

        const { data: overdueObligations, error } = await query;
        
        if (error) throw error;

        const penaltyUpdates = [];

        for (const obligation of overdueObligations || []) {
          const { penalties, interest } = calculatePenalties(
            obligation.due_date, 
            currentDate, 
            obligation.amount_due
          );

          const updatedObligation = {
            ...obligation,
            penalties,
            interest,
            auto_calculated_penalties: true,
            updated_at: new Date().toISOString()
          };

          penaltyUpdates.push(updatedObligation);

          if (args.apply_penalties) {
            await supabase
              .from('tax_obligations')
              .update({
                penalties,
                interest,
                auto_calculated_penalties: true,
                updated_at: new Date().toISOString()
              })
              .eq('id', obligation.id);

            // Log audit trail
            await logAuditTrail(
              'PENALTIES_CALCULATED',
              args.taxpayer_id,
              'OBLIGATION',
              obligation.id,
              { penalties: obligation.penalties, interest: obligation.interest },
              { penalties, interest }
            );
          }
        }

        const totalPenalties = penaltyUpdates.reduce((sum, o) => sum + o.penalties, 0);
        const totalInterest = penaltyUpdates.reduce((sum, o) => sum + o.interest, 0);

        return {
          content: [
            {
              type: "text",
              text: `⚠️ Penalty Calculation Results\n\n📊 Overdue Obligations: ${penaltyUpdates.length}\n💰 Total Penalties: KES ${totalPenalties.toLocaleString()}\n📈 Total Interest: KES ${totalInterest.toLocaleString()}\n💸 Total Additional Amount: KES ${(totalPenalties + totalInterest).toLocaleString()}\n\n${args.apply_penalties ? '✅ Penalties have been applied to your obligations.' : '⚠️ Penalties calculated but not applied. Set apply_penalties=true to apply them.'}\n\n📋 Breakdown:\n${penaltyUpdates.map(o => `• ${o.obligation_type}: KES ${o.penalties.toLocaleString()} penalty + KES ${o.interest.toLocaleString()} interest`).join('\n')}\n\n🎯 Action Required: Pay overdue amounts immediately to avoid further penalties.`
            }
          ]
        };
      }

      case "queue_kra_submission": {
        // Get the return data
        let returnData = null;
        let returnTable = '';
        
        switch (args.return_type) {
          case 'VAT':
            returnTable = 'vat_returns';
            break;
          case 'PAYE':
            returnTable = 'paye_returns';
            break;
          case 'WHT':
            returnTable = 'withholding_tax';
            break;
        }

        const { data: returnDataResult } = await supabase
          .from(returnTable)
          .select('*')
          .eq('id', args.return_id)
          .single();

        if (!returnDataResult) {
          return {
            content: [
              {
                type: "text",
                text: `❌ ${args.return_type} return not found with ID: ${args.return_id}`
              }
            ],
            isError: true
          };
        }

        const queueItem: KRASubmissionQueue = {
          id: generateId(),
          taxpayer_id: args.taxpayer_id,
          return_type: args.return_type,
          return_data: returnDataResult,
          submission_status: 'pending',
          retry_count: 0,
          last_attempt: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };

        const { data, error } = await supabase
          .from('kra_submission_queue')
          .insert([queueItem])
          .select()
          .single();

        if (error) throw error;

        return {
          content: [
            {
              type: "text",
              text: `📤 KRA Submission Queued\n\n📋 Submission Details:\n• Return Type: ${args.return_type}\n• Return ID: ${args.return_id}\n• Queue Position: ${data.id}\n• Priority: ${args.priority || 'normal'}\n\n⏱️ Status: PENDING\n\n🔄 Your return will be submitted to KRA automatically. You'll receive a notification once completed.\n\n💡 Tip: Keep your internet connection stable for successful submission.`
            }
          ]
        };
      }

      case "get_upcoming_deadlines": {
        const currentDate = new Date();
        const futureDate = new Date(currentDate);
        futureDate.setDate(currentDate.getDate() + args.days_ahead);

        const { data: obligations } = await supabase
          .from('tax_obligations')
          .select('*')
          .eq('taxpayer_id', args.taxpayer_id)
          .gte('due_date', currentDate.toISOString().split('T')[0])
          .lte('due_date', futureDate.toISOString().split('T')[0])
          .order('due_date', { ascending: true });

        const deadlines = [];
        
        for (const obligation of obligations || []) {
          const daysUntilDue = daysBetween(currentDate.toISOString(), obligation.due_date);
          let urgency = '🟢';
          
          if (daysUntilDue <= 3) urgency = '🔴';
          else if (daysUntilDue <= 7) urgency = '🟡';
          
          let estimatedAmount = obligation.amount_due;
          
          if (args.include_estimates && estimatedAmount === 0) {
            // Simple estimation based on historical data or business size
            switch (obligation.obligation_type) {
              case 'VAT':
                estimatedAmount = 50000; // Placeholder estimation
                break;
              case 'PAYE':
                estimatedAmount = 30000; // Placeholder estimation
                break;
              case 'WHT':
                estimatedAmount = 5000; // Placeholder estimation
                break;
            }
          }

          deadlines.push({
            obligation,
            days_until_due: daysUntilDue,
            urgency,
            estimated_amount: estimatedAmount
          });
        }

        return {
          content: [
            {
              type: "text",
              text: `📅 Upcoming Tax Deadlines (${args.days_ahead} days)\n\n${deadlines.length === 0 ? '✅ No upcoming deadlines!' : deadlines.map(d => `${d.urgency} ${d.obligation.obligation_type}\n• Due: ${d.obligation.due_date} (${d.days_until_due} days)\n• Estimated: KES ${d.estimated_amount.toLocaleString()}\n• Status: ${d.obligation.status.toUpperCase()}`).join('\n\n')}\n\n🎯 Total Estimated: KES ${deadlines.reduce((sum, d) => sum + d.estimated_amount, 0).toLocaleString()}\n\n💡 Reminders:\n• File returns 2-3 days before deadline\n• Keep receipts and invoices ready\n• Set up M-Pesa auto-pay for peace of mind`
            }
          ]
        };
      }

      case "file_paye_return": {
        const dueDate = getKRADeadline('PAYE', new Date(args.period_year, args.period_month - 1));
        const currentDate = new Date();

        const employees: EmployeeP9[] = args.employees.map((emp: any) => {
          const grossPay = emp.basic_salary + emp.allowances;
          const nssfDeduction = calculateNSSF(grossPay);
          const nhifDeduction = calculateNHIF(grossPay);
          const housingLevy = calculateHousingLevy(grossPay);
          const payeTax = calculatePAYE(grossPay, nssfDeduction, emp.pension_contribution || 0, emp.insurance_relief || 0);
          const netPay = grossPay - nssfDeduction - nhifDeduction - payeTax - housingLevy;

          // Validate employee KRA PIN
          const pinValidation = validateKRAPIN(emp.employee_kra_pin);
          if (!pinValidation.valid) {
            throw new Error(`Employee ${emp.employee_name}: ${pinValidation.error}`);
          }

          return {
            employee_kra_pin: emp.employee_kra_pin.toUpperCase(),
            employee_name: emp.employee_name,
            basic_salary: emp.basic_salary,
            allowances: emp.allowances,
            gross_pay: grossPay,
            nssf_deduction: nssfDeduction,
            pension_contribution: emp.pension_contribution || 0,
            owner_occupier_interest: 0,
            insurance_relief: emp.insurance_relief || 0,
            taxable_income: Math.max(0, grossPay - nssfDeduction - (emp.pension_contribution || 0) - KENYA_TAX_RATES.PAYE_PERSONAL_RELIEF - Math.min(emp.insurance_relief || 0, KENYA_TAX_RATES.INSURANCE_RELIEF_MAX)),
            paye_tax: payeTax,
            nhif_deduction: nhifDeduction,
            housing_levy: housingLevy,
            net_pay: netPay
          };
        });

        const payeReturn: PAYEReturn = {
          id: generateId(),
          taxpayer_id: args.taxpayer_id,
          period_month: args.period_month,
          period_year: args.period_year,
          total_employees: employees.length,
          total_gross_pay: employees.reduce((sum, emp) => sum + emp.gross_pay, 0),
          total_paye_deducted: employees.reduce((sum, emp) => sum + emp.paye_tax, 0),
          total_nhif_deducted: employees.reduce((sum, emp) => sum + emp.nhif_deduction, 0),
          total_nssf_deducted: employees.reduce((sum, emp) => sum + emp.nssf_deduction, 0),
          total_housing_levy: employees.reduce((sum, emp) => sum + emp.housing_levy, 0),
          total_affordable_housing_levy: employees.reduce((sum, emp) => sum + emp.housing_levy, 0),
          net_paye_due: employees.reduce((sum, emp) => sum + emp.paye_tax, 0),
          penalties: 0,
          interest: 0,
          total_due: employees.reduce((sum, emp) => sum + emp.paye_tax, 0),
          filing_date: new Date().toISOString(),
          due_date: dueDate.toISOString().split('T')[0],
          status: 'filed',
          p9_forms: employees,
          auto_penalties_calculated: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };

        // Auto-calculate penalties if late filing
        if (args.auto_calculate_penalties && currentDate > dueDate) {
          const penaltyCalc = calculatePenalties(
            payeReturn.due_date, 
            currentDate.toISOString().split('T')[0], 
            payeReturn.net_paye_due
          );
          payeReturn.penalties = penaltyCalc.penalties;
          payeReturn.interest = penaltyCalc.interest;
          payeReturn.auto_penalties_calculated = true;
          payeReturn.total_due = payeReturn.net_paye_due + payeReturn.penalties + payeReturn.interest;
        }

        const { data, error } = await supabase
          .from('paye_returns')
          .insert([payeReturn])
          .select()
          .single();
        
        if (error) throw error;

        // Log audit trail
        await logAuditTrail('PAYE_RETURN_FILED', args.taxpayer_id, 'PAYE_RETURN', data.id, null, data);

        const isLate = currentDate > dueDate;

        return {
          content: [
            {
              type: "text",
              text: `✅ PAYE Return Filed Successfully!\n\n📋 Return Details:\n• Period: ${args.period_month}/${args.period_year}\n• Total Employees: ${payeReturn.total_employees}\n• Total Gross Pay: KES ${payeReturn.total_gross_pay.toLocaleString()}\n\n💰 Statutory Deductions:\n• PAYE Tax: KES ${payeReturn.total_paye_deducted.toLocaleString()}\n• NSSF: KES ${payeReturn.total_nssf_deducted.toLocaleString()}\n• NHIF: KES ${payeReturn.total_nhif_deducted.toLocaleString()}\n• Housing Levy: KES ${payeReturn.total_housing_levy.toLocaleString()}\n\n💸 NET PAYE DUE: KES ${payeReturn.net_paye_due.toLocaleString()}\n${payeReturn.penalties > 0 ? `⚠️ Late Filing Penalty: KES ${payeReturn.penalties.toLocaleString()}` : ''}\n${payeReturn.interest > 0 ? `📈 Interest: KES ${payeReturn.interest.toLocaleString()}` : ''}\n\n💰 TOTAL AMOUNT DUE: KES ${payeReturn.total_due.toLocaleString()}\n\n📅 Filed: ${new Date().toLocaleDateString()}\n${isLate ? '⏰ Status: LATE FILING' : '✅ Status: ON TIME'}\n\n👥 Employee Breakdown:\n${employees.slice(0, 3).map(emp => `• ${emp.employee_name}: KES ${emp.paye_tax.toLocaleString()} PAYE`).join('\n')}${employees.length > 3 ? `\n• ... and ${employees.length - 3} more employees` : ''}\n\n🎯 Next Steps:\n• Pay by ${payeReturn.due_date}\n• Issue P9 forms to employees\n• Keep payroll records for audit`
            }
          ]
        };
      }

      case "file_withholding_tax": {
        // Validate supplier KRA PIN
        const pinValidation = validateKRAPIN(args.supplier_pin);
        if (!pinValidation.valid) {
          return {
            content: [
              {
                type: "text",
                text: `❌ Supplier KRA PIN: ${pinValidation.error}`
              }
            ],
            isError: true
          };
        }

        const whtRate = KENYA_TAX_RATES.WHT_RATES[args.service_type as keyof typeof KENYA_TAX_RATES.WHT_RATES] || 0.05;
        const whtAmount = args.invoice_amount * whtRate;

        const withholdingTax: WithholdingTax = {
          id: generateId(),
          taxpayer_id: args.taxpayer_id,
          period_month: args.period_month,
          period_year: args.period_year,
          supplier_pin: args.supplier_pin.toUpperCase(),
          supplier_name: args.supplier_name,
          invoice_amount: args.invoice_amount,
          wht_rate: whtRate,
          wht_amount: whtAmount,
          service_type: args.service_type,
          payment_date: args.payment_date,
          filing_date: new Date().toISOString(),
          status: 'filed',
          created_at: new Date().toISOString()
        };

        const { data, error } = await supabase
          .from('withholding_tax')
          .insert([withholdingTax])
          .select()
          .single();
        
        if (error) throw error;

        // Log audit trail
        await logAuditTrail('WHT_FILED', args.taxpayer_id, 'WHT', data.id, null, data);

        return {
          content: [
            {
              type: "text",
              text: `✅ Withholding Tax Filed Successfully!\n\n📋 WHT Details:\n• Supplier: ${args.supplier_name}\n• KRA PIN: ${args.supplier_pin.toUpperCase()}\n• Service Type: ${args.service_type.toUpperCase()}\n• Invoice Amount: KES ${args.invoice_amount.toLocaleString()}\n• WHT Rate: ${(whtRate * 100).toFixed(1)}%\n\n💰 WHT AMOUNT: KES ${whtAmount.toLocaleString()}\n💸 Net Payment to Supplier: KES ${(args.invoice_amount - whtAmount).toLocaleString()}\n\n📅 Payment Date: ${args.payment_date}\n📅 Filed: ${new Date().toLocaleDateString()}\n\n🎯 Next Steps:\n• Pay WHT to KRA by 20th of next month\n• Issue WHT certificate to supplier\n• Keep invoice and payment proof`
            }
          ]
        };
      }

      case "get_tax_obligations": {
        let query = supabase
          .from('tax_obligations')
          .select('*')
          .eq('taxpayer_id', args.taxpayer_id)
          .order('due_date', { ascending: true });

        if (args.status) {
          query = query.eq('status', args.status);
        }

        const { data, error } = await query;
        if (error) throw error;

        const currentDate = new Date();
        const groupedObligations = {
          overdue: data?.filter(o => new Date(o.due_date) < currentDate && o.status !== 'paid') || [],
          upcoming: data?.filter(o => {
            const dueDate = new Date(o.due_date);
            const inTwoWeeks = new Date(currentDate);
            inTwoWeeks.setDate(currentDate.getDate() + 14);
            return dueDate >= currentDate && dueDate <= inTwoWeeks && o.status !== 'paid';
          }) || [],
          future: data?.filter(o => {
            const dueDate = new Date(o.due_date);
            const inTwoWeeks = new Date(currentDate);
            inTwoWeeks.setDate(currentDate.getDate() + 14);
            return dueDate > inTwoWeeks && o.status !== 'paid';
          }) || [],
          completed: data?.filter(o => o.status === 'paid') || []
        };

        const totalOutstanding = groupedObligations.overdue.reduce((sum, o) => sum + (o.amount_due - o.amount_paid), 0) +
                               groupedObligations.upcoming.reduce((sum, o) => sum + (o.amount_due - o.amount_paid), 0);

        return {
          content: [
            {
              type: "text",
              text: `📊 Tax Obligations Summary\n\n🔴 OVERDUE (${groupedObligations.overdue.length}):\n${groupedObligations.overdue.length === 0 ? '✅ None' : groupedObligations.overdue.map(o => `• ${o.obligation_type}: KES ${(o.amount_due - o.amount_paid).toLocaleString()} (Due: ${o.due_date})`).join('\n')}\n\n🟡 UPCOMING (${groupedObligations.upcoming.length}):\n${groupedObligations.upcoming.length === 0 ? '✅ None in next 2 weeks' : groupedObligations.upcoming.map(o => `• ${o.obligation_type}: KES ${(o.amount_due - o.amount_paid).toLocaleString()} (Due: ${o.due_date})`).join('\n')}\n\n🟢 COMPLETED (${groupedObligations.completed.length}):\n${groupedObligations.completed.slice(0, 3).map(o => `• ${o.obligation_type}: KES ${o.amount_paid.toLocaleString()} ✅`).join('\n')}${groupedObligations.completed.length > 3 ? `\n• ... and ${groupedObligations.completed.length - 3} more` : ''}\n\n💰 TOTAL OUTSTANDING: KES ${totalOutstanding.toLocaleString()}\n\n${groupedObligations.overdue.length > 0 ? '⚠️ URGENT: Pay overdue amounts immediately to avoid penalties!' : '✅ No overdue obligations - great job!'}`
            }
          ]
        };
      }

      case "calculate_tax_liability": {
        let result = {};

        switch (args.tax_type) {
          case 'PAYE': {
            const grossPay = args.amount;
            const nssfDeduction = calculateNSSF(grossPay);
            const nhifDeduction = calculateNHIF(grossPay);
            const housingLevy = calculateHousingLevy(grossPay);
            const payeTax = calculatePAYE(
              grossPay, 
              nssfDeduction, 
              args.additional_params?.pension_contribution || 0,
              args.additional_params?.insurance_relief || 0
            );

            result = {
              gross_pay: grossPay,
              nssf_deduction: nssfDeduction,
              nhif_deduction: nhifDeduction,
              housing_levy: housingLevy,
              paye_tax: payeTax,
              net_pay: grossPay - nssfDeduction - nhifDeduction - housingLevy - payeTax,
              total_statutory_deductions: nssfDeduction + nhifDeduction + housingLevy + payeTax,
              take_home_percentage: ((grossPay - nssfDeduction - nhifDeduction - housingLevy - payeTax) / grossPay * 100).toFixed(1)
            };
            break;
          }
          case 'VAT': {
            const isInclusive = args.additional_params?.inclusive || false;
            let vatAmount, netAmount, totalAmount;
            
            if (isInclusive) {
              // Amount includes VAT
              totalAmount = args.amount;
              vatAmount = totalAmount - (totalAmount / (1 + KENYA_TAX_RATES.VAT_STANDARD));
              netAmount = totalAmount - vatAmount;
            } else {
              // Amount excludes VAT
              netAmount = args.amount;
              vatAmount = netAmount * KENYA_TAX_RATES.VAT_STANDARD;
              totalAmount = netAmount + vatAmount;
            }
            
            result = {
              net_amount: netAmount,
              vat_amount: vatAmount,
              total_amount: totalAmount,
              vat_rate: KENYA_TAX_RATES.VAT_STANDARD,
              calculation_type: isInclusive ? 'VAT Inclusive' : 'VAT Exclusive'
            };
            break;
          }
          case 'WHT': {
            const serviceType = args.additional_params?.service_type || 'consultancy';
            const whtRate = KENYA_TAX_RATES.WHT_RATES[serviceType as keyof typeof KENYA_TAX_RATES.WHT_RATES] || 0.05;
            result = {
              invoice_amount: args.amount,
              wht_rate: whtRate,
              wht_amount: args.amount * whtRate,
              net_payment: args.amount - (args.amount * whtRate),
              service_type: serviceType,
              wht_percentage: (whtRate * 100).toFixed(1) + '%'
            };
            break;
          }
        }

        return {
          content: [
            {
              type: "text",
              text: `🧮 Tax Calculation: ${args.tax_type}\n\n${Object.entries(result).map(([key, value]) => `• ${key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}: ${typeof value === 'number' ? 'KES ' + value.toLocaleString() : value}`).join('\n')}\n\n💡 This is an estimate. Actual taxes may vary based on specific circumstances.`
            }
          ]
        };
      }

      case "check_compliance_status": {
        // Get all tax obligations for the taxpayer
        const { data: obligations, error: obligationsError } = await supabase
          .from('tax_obligations')
          .select('*')
          .eq('taxpayer_id', args.taxpayer_id);

        if (obligationsError) throw obligationsError;

        // Get taxpayer details
        const { data: taxpayer, error: taxpayerError } = await supabase
          .from('taxpayers')
          .select('*')
          .eq('id', args.taxpayer_id)
          .single();

        if (taxpayerError) throw taxpayerError;

        const currentDate = new Date();
        const overdueObligations = obligations?.filter(o => 
          new Date(o.due_date) < currentDate && o.status !== 'paid'
        ) || [];

        const upcomingObligations = obligations?.filter(o => {
          const dueDate = new Date(o.due_date);
          const nextWeek = new Date(currentDate);
          nextWeek.setDate(currentDate.getDate() + 7);
          return dueDate >= currentDate && dueDate <= nextWeek && o.status !== 'paid';
        }) || [];

        const complianceStatus = {
          taxpayer_name: taxpayer.business_name,
          kra_pin: taxpayer.kra_pin,
          total_obligations: obligations?.length || 0,
          paid_obligations: obligations?.filter(o => o.status === 'paid').length || 0,
          pending_obligations: obligations?.filter(o => o.status === 'pending').length || 0,
          overdue_obligations: overdueObligations.length,
          upcoming_obligations: upcomingObligations.length,
          total_amount_due: obligations?.reduce((sum, o) => sum + (o.amount_due - o.amount_paid), 0) || 0,
          total_penalties: obligations?.reduce((sum, o) => sum + o.penalties, 0) || 0,
          total_interest: obligations?.reduce((sum, o) => sum + o.interest, 0) || 0,
          compliance_certificate_eligible: overdueObligations.length === 0,
          compliance_status: overdueObligations.length === 0 ? 'COMPLIANT' : 'NON-COMPLIANT',
          risk_level: overdueObligations.length === 0 ? 'LOW' : overdueObligations.length <= 2 ? 'MEDIUM' : 'HIGH'
        };

        const recommendations = [];
        if (overdueObligations.length > 0) {
          recommendations.push(`💰 Pay ${overdueObligations.length} overdue obligation(s) immediately`);
          recommendations.push('📞 Contact KRA for payment plan if needed');
          recommendations.push('🔔 Set up payment reminders to avoid future delays');
        } else {
          recommendations.push('✅ Great job! You are tax compliant');
          recommendations.push('📅 Continue filing returns on time');
          recommendations.push('💰 Pay taxes before due dates');
        }

        if (upcomingObligations.length > 0) {
          recommendations.push(`⏰ ${upcomingObligations.length} obligation(s) due within 7 days`);
        }

        return {
          content: [
            {
              type: "text",
              text: `📊 Compliance Status Report\n\n🏢 ${complianceStatus.taxpayer_name}\n📄 KRA PIN: ${complianceStatus.kra_pin}\n\n${complianceStatus.compliance_status === 'COMPLIANT' ? '✅' : '❌'} Status: ${complianceStatus.compliance_status}\n🎯 Risk Level: ${complianceStatus.risk_level}\n📜 Certificate Eligible: ${complianceStatus.compliance_certificate_eligible ? '✅ YES' : '❌ NO'}\n\n📈 Obligations Summary:\n• Total: ${complianceStatus.total_obligations}\n• Paid: ${complianceStatus.paid_obligations}\n• Pending: ${complianceStatus.pending_obligations}\n• Overdue: ${complianceStatus.overdue_obligations}\n• Due This Week: ${complianceStatus.upcoming_obligations}\n\n💰 Financial Summary:\n• Amount Due: KES ${complianceStatus.total_amount_due.toLocaleString()}\n• Penalties: KES ${complianceStatus.total_penalties.toLocaleString()}\n• Interest: KES ${complianceStatus.total_interest.toLocaleString()}\n\n💡 Recommendations:\n${recommendations.map(r => `${r}`).join('\n')}`
            }
          ]
        };
      }

      case "get_kra_rates": {
        let rates = {};

        if (args.rate_type === 'all' || !args.rate_type) {
          rates = {
            VAT: {
              standard_rate: `${(KENYA_TAX_RATES.VAT_STANDARD * 100)}%`,
              zero_rate: `${(KENYA_TAX_RATES.VAT_ZERO * 100)}%`,
              exempt: "No VAT charged"
            },
            PAYE: {
              tax_bands: PAYE_TAX_BANDS.map(band => ({
                income_range: `KES ${band.min.toLocaleString()} - ${band.max === Infinity ? 'Above' : band.max.toLocaleString()}`,
                rate: `${(band.rate * 100)}%`
              })),
              personal_relief: `KES ${KENYA_TAX_RATES.PAYE_PERSONAL_RELIEF.toLocaleString()}/month`,
              insurance_relief_max: `KES ${KENYA_TAX_RATES.INSURANCE_RELIEF_MAX.toLocaleString()}/month`
            },
            NSSF: {
              rate: `${(KENYA_TAX_RATES.NSSF_RATE * 100)}%`,
              ceiling: "KES 18,000/month",
              description: "6% of pensionable pay up to KES 18,000"
            },
            NHIF: {
              description: "Based on gross pay bands",
              range: "KES 150 - 1,700 depending on salary"
            },
            HOUSING_LEVY: {
              rate: `${(KENYA_TAX_RATES.HOUSING_LEVY_RATE * 100)}%`,
              description: "1.5% of gross salary"
            },
            WITHHOLDING_TAX: Object.entries(KENYA_TAX_RATES.WHT_RATES).map(([service, rate]) => ({
              service_type: service,
              rate: `${(rate * 100)}%`
            }))
          };
        } else {
          switch (args.rate_type) {
            case 'VAT':
              rates = {
                standard_rate: `${(KENYA_TAX_RATES.VAT_STANDARD * 100)}%`,
                zero_rate: `${(KENYA_TAX_RATES.VAT_ZERO * 100)}%`,
                exempt: "No VAT charged"
              };
              break;
            case 'PAYE':
              rates = {
                tax_bands: PAYE_TAX_BANDS,
                personal_relief: KENYA_TAX_RATES.PAYE_PERSONAL_RELIEF
              };
              break;
            case 'WHT':
              rates = KENYA_TAX_RATES.WHT_RATES;
              break;
            case 'NHIF':
              rates = { description: "KES 150 - 1,700 based on salary bands" };
              break;
            case 'NSSF':
              rates = { 
                rate: KENYA_TAX_RATES.NSSF_RATE, 
                ceiling: 18000 
              };
              break;
          }
        }

        return {
          content: [
            {
              type: "text",
              text: `📊 KRA Tax Rates (${args.rate_type || 'All'})\n\n${JSON.stringify(rates, null, 2).replace(/[{}",]/g, '').replace(/\n\s+/g, '\n').trim()}\n\n📅 Rates current as of 2025\n💡 Rates may change - always verify with KRA for latest updates`
            }
          ]
        };
      }

      case "generate_tax_report": {
        const { data: taxpayer } = await supabase
          .from('taxpayers')
          .select('*')
          .eq('id', args.taxpayer_id)
          .single();

        const { data: obligations } = await supabase
          .from('tax_obligations')
          .select('*')
          .eq('taxpayer_id', args.taxpayer_id)
          .gte('period_start', args.period_start)
          .lte('period_end', args.period_end);

        const { data: vatReturns } = await supabase
          .from('vat_returns')
          .select('*')
          .eq('taxpayer_id', args.taxpayer_id)
          .gte('filing_date', args.period_start)
          .lte('filing_date', args.period_end);

        const { data: payeReturns } = await supabase
          .from('paye_returns')
          .select('*')
          .eq('taxpayer_id', args.taxpayer_id)
          .gte('filing_date', args.period_start)
          .lte('filing_date', args.period_end);

        const { data: whtReturns } = await supabase
          .from('withholding_tax')
          .select('*')
          .eq('taxpayer_id', args.taxpayer_id)
          .gte('filing_date', args.period_start)
          .lte('filing_date', args.period_end);

        let report = {};

        switch (args.report_type) {
          case 'summary':
            const totalVAT = vatReturns?.reduce((sum, v) => sum + v.total_due, 0) || 0;
            const totalPAYE = payeReturns?.reduce((sum, p) => sum + p.total_due, 0) || 0;
            const totalWHT = whtReturns?.reduce((sum, w) => sum + w.wht_amount, 0) || 0;
            const totalTaxes = totalVAT + totalPAYE + totalWHT;

            report = {
              taxpayer: {
                name: taxpayer?.business_name,
                kra_pin: taxpayer?.kra_pin
              },
              period: `${args.period_start} to ${args.period_end}`,
              summary: {
                total_vat_filed: totalVAT,
                total_paye_filed: totalPAYE,
                total_wht_filed: totalWHT,
                total_taxes: totalTaxes,
                total_obligations: obligations?.length || 0,
                paid_obligations: obligations?.filter(o => o.status === 'paid').length || 0,
                pending_amount: obligations?.reduce((sum, o) => sum + (o.amount_due - o.amount_paid), 0) || 0,
                compliance_rate: obligations?.length ? ((obligations.filter(o => o.status === 'paid').length / obligations.length) * 100).toFixed(1) + '%' : '100%'
              }
            };
            break;

          case 'detailed':
            report = {
              taxpayer: taxpayer,
              period: `${args.period_start} to ${args.period_end}`,
              vat_returns: vatReturns,
              paye_returns: payeReturns,
              withholding_tax: whtReturns,
              tax_obligations: obligations
            };
            break;

          case 'compliance':
            const currentDate = new Date();
            const overdueObligations = obligations?.filter(o => 
              new Date(o.due_date) < currentDate && o.status !== 'paid'
            ) || [];

            const totalPenalties = obligations?.reduce((sum, o) => sum + o.penalties, 0) || 0;
            const totalInterest = obligations?.reduce((sum, o) => sum + o.interest, 0) || 0;

            report = {
              taxpayer: {
                name: taxpayer?.business_name,
                kra_pin: taxpayer?.kra_pin
              },
              compliance_status: overdueObligations.length === 0 ? 'COMPLIANT' : 'NON-COMPLIANT',
              overdue_obligations: overdueObligations.length,
              total_penalties: totalPenalties,
              total_interest: totalInterest,
              compliance_certificate_eligible: overdueObligations.length === 0 && totalPenalties === 0,
              risk_assessment: overdueObligations.length === 0 ? 'LOW RISK'
        const dueDate = getKRADeadline('VAT', new Date(args.period_year, args.period_month - 1));
        const currentDate = new Date();
        
        const vatReturn: VATReturn = {
          id: generateId(),
          taxpayer_id: args.taxpayer_id,
          period_month: args.period_month,
          period_year: args.period_year,
          taxable_supplies: args.taxable_supplies,
          vat_on_supplies: args.taxable_supplies * KENYA_TAX_RATES.VAT_STANDARD,
          taxable_purchases: args.taxable_purchases,
          vat_on_purchases: args.taxable_purchases * KENYA_TAX_RATES.VAT_STANDARD,
          imported_services: args.imported_services || 0,
          vat_on_imported_services: (args.imported_services || 0) * KENYA_TAX_RATES.VAT_STANDARD,
          net_vat_due: 0,
          penalties: 0,
          interest: 0,
          total_due: 0,
          filing_date: new Date().toISOString(),
          due_date: dueDate.toISOString().split('T')[0],
          status: 'filed',
          auto_penalties_calculated: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };

        // Calculate net VAT due
        vatReturn.net_vat_due = Math.max(0, 
          vatReturn.vat_on_supplies + vatReturn.vat_on_imported_services - vatReturn.vat_on_purchases
        );

        // Auto-calculate penalties if late filing
        if (args.auto_calculate_penalties && currentDate > dueDate) {
          const penaltyCalc = calculatePenalties(
            vatReturn.due_date, 
            currentDate.toISOString().split('T')[0], 
            vatReturn.net_vat_due
          );
          vatReturn.penalties = penaltyCalc.penalties;
          vatReturn.interest = penaltyCalc.interest;
          vatReturn.auto_penalties_calculated = true;
        }

        vatReturn.total_due = vatReturn.net_vat_due + vatReturn.penalties + vatReturn.interest;

        const { data, error } = await supabase
          .from('vat_returns')
          .insert([vatReturn])
          .select()
          .single();
        
        if (error) throw error;

        // Log audit trail
        await logAuditTrail('VAT_RETURN_FILED', args.taxpayer_id, 'VAT_RETURN', data.id, null, data);

        const isLate = currentDate > dueDate;
        const refundDue = vatReturn.net_vat_due < 0;

        return {
          content: [
            {
              type: "text",
              text: `✅ VAT Return Filed Successfully!\n\n📋 Return Details:\n• Period: ${args.period_month}/${args.period_year}\n• Taxable Supplies: KES ${args.taxable_supplies.toLocaleString()}\n• VAT on Supplies: KES ${vatReturn.vat_on_supplies.toLocaleString()}\n• Taxable Purchases: KES ${args.taxable_purchases.toLocaleString()}\n• VAT on Purchases: KES ${vatReturn.vat_on_purchases.toLocaleString()}\n\n💰 ${refundDue ? 'VAT REFUND DUE' : 'NET VAT DUE'}: KES ${Math.abs(vatReturn.net_vat_due).toLocaleString()}\n${vatReturn.penalties > 0 ? `⚠️ Late Filing Penalty: KES ${vatReturn.penalties.toLocaleString()}` : ''}\n${vatReturn.interest > 0 ? `📈 Interest: KES ${vatReturn.interest.toLocaleString()}` : ''}\n\n💸 TOTAL ${refundDue ? 'REFUND' : 'AMOUNT'}: KES ${Math.abs(vatReturn.total_due).toLocaleString()}\n\n📅 Filed: ${new Date().toLocaleDateString()}\n${isLate ? '⏰ Status: LATE FILING' : '✅ Status: ON TIME'}\n\n🎯 Next Steps:\n${refundDue ? '• Wait for KRA refund processing' : '• Pay by ' + vatReturn.due_date}\n• Keep receipts for audit purposes\n• Set reminder for next month`
            }
          ]
        };
      }
