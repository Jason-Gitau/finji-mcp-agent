if (overdueCount > 0) {
          responseText += `⚠️ URGENT ACTION REQUIRED:\n`;
          responseText += `• Pay overdue obligations immediately\n`;
          responseText += `• Contact KRA if payment plan needed\n`;
          responseText += `• Risk of compliance certificate denial\n\n`;
        }

        responseText += `📱 Use Finji to track payments and get reminders!`;

        return {
          content: [{
            type: "text",
            text: responseText
          }]
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
              total_statutory_deductions: nssfDeduction + nhifDeduction + housingLevy + payeTax
            };
            break;
          }
          case 'VAT': {
            result = {
              amount: args.amount,
              vat_amount: args.amount * KENYA_TAX_RATES.VAT_STANDARD,
              total_inclusive: args.amount * (1 + KENYA_TAX_RATES.VAT_STANDARD),
              vat_rate: KENYA_TAX_RATES.VAT_STANDARD
            };
            break;
          }
          case 'WHT': {
            const serviceType = args.additional_params?.service_type || 'consultancy';
            const whtRate = KENYA_TAX_RATES.WHT_RATES[serviceType] || 0.05;
            result = {
              invoice_amount: args.amount,
              wht_rate: whtRate,
              wht_amount: args.amount * whtRate,
              net_payment: args.amount - (args.amount * whtRate),
              service_type: serviceType
            };
            break;
          }
        }

        return {
          content: [{
            type: "text",
            text: `Tax calculation for ${args.tax_type}:\n${JSON.stringify(result, null, 2)}`
          }]
        };
      }

      case "check_compliance_status": {
        const complianceScore = await calculateComplianceScore(args.taxpayer_id);
        
        const { data: obligations } = await supabase
          .from('tax_obligations')
          .select('*')
          .eq('taxpayer_id', args.taxpayer_id);

        const { data: taxpayer } = await supabase
          .from('taxpayers')
          .select('*')
          .eq('id', args.taxpayer_id)
          .single();

        const currentDate = new Date();
        const overdueObligations = obligations?.filter(o => 
          new Date(o.due_date) < currentDate && o.status !== 'paid'
        ) || [];

        const complianceStatus = {
          taxpayer_name: taxpayer?.business_name,
          kra_pin: taxpayer?.kra_pin,
          compliance_score: complianceScore.score,
          risk_level: complianceScore.risk_level,
          total_obligations: obligations?.length || 0,
          paid_obligations: obligations?.filter(o => o.status === 'paid').length || 0,
          overdue_obligations: overdueObligations.length,
          total_amount_due: obligations?.reduce((sum, o) => sum + (o.amount_due - o.amount_paid), 0) || 0,
          compliance_certificate_eligible: complianceScore.certificate_eligibility,
          recommendations: complianceScore.improvement_tips
        };

        return {
          content: [{
            type: "text",
            text: `Compliance Status Report:\n${JSON.stringify(complianceStatus, null, 2)}`
          }]
        };
      }

      case "get_kra_rates": {
        let rates = KENYA_TAX_RATES;
        if (args.rate_type && args.rate_type !== 'all') {
          switch (args.rate_type) {
            case 'VAT':
              rates = { VAT_STANDARD: KENYA_TAX_RATES.VAT_STANDARD };
              break;
            case 'PAYE':
              rates = { PAYE_BANDS: PAYE_TAX_BANDS, PERSONAL_RELIEF: KENYA_TAX_RATES.PAYE_PERSONAL_RELIEF };
              break;
            case 'WHT':
              rates = { WHT_RATES: KENYA_TAX_RATES.WHT_RATES };
              break;
            default:
              rates = KENYA_TAX_RATES;
          }
        }

        return {
          content: [{
            type: "text",
            text: `KRA Tax Rates:\n${JSON.stringify(rates, null, 2)}`
          }]
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

        const report = {
          taxpayer: taxpayer,
          period: `${args.period_start} to ${args.period_end}`,
          summary: {
            total_obligations: obligations?.length || 0,
            paid_obligations: obligations?.filter(o => o.status === 'paid').length || 0,
            pending_amount: obligations?.reduce((sum, o) => sum + (o.amount_due - o.amount_paid), 0) || 0
          },
          obligations: obligations
        };

        return {
          content: [{
            type: "text",
            text: `Tax Report:\n${JSON.stringify(report, null, 2)}`
          }]
        };
      }

      case "update_payment_status": {
        const { data, error } = await supabase
          .from('tax_obligations')
          .update({
            amount_paid: args.amount_paid,
            status: 'paid',
            updated_at: new Date().toISOString()
          })
          .eq('id', args.obligation_id)
          .select()
          .single();

        if (error) throw error;

        await logAuditTrail('PAYMENT_UPDATED', data.taxpayer_id, null, data);

        return {
          content: [{
            type: "text",
            text: `Payment status updated successfully:\n${JSON.stringify(data, null, 2)}`
          }]
        };
      }

      case "list_taxpayers": {
        let query = supabase
          .from('taxpayers')
          .select('*')
          .order('created_at', { ascending: false });

        if (args.business_type) {
          query = query.eq('business_type', args.business_type);
        }

        if (args.vat_registered !== undefined) {
          query = query.eq('is_vat_registered', args.vat_registered);
        }

        const { data, error } = await query;
        if (error) throw error;

        return {
          content: [{
            type: "text",
            text: `Taxpayers (${data.length}):\n${JSON.stringify(data, null, 2)}`
          }]
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [{
        type: "text",
        text: `Error: ${error instanceof Error ? error.message : String(error)}`
      }],
      isError: true
    };
  }
}

// Main handler
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  try {
    const body = await req.json();
    
    if (body.method === 'tools/list') {
      return new Response(JSON.stringify({ tools }), {
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
      });
    }
    
    if (body.method === 'tools/call') {
      const { name, arguments: args } = body.params;
      const result = await handleTool(name, args);
      
      return new Response(JSON.stringify(result), {
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
      });
    }

    return new Response(JSON.stringify({ error: 'Unknown method' }), {
      status: 400,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
    });

  } catch (error) {
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
    });
  }
});// Enhanced Supabase Edge Function for Kenya Tax Compliance MCP Server
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
  compliance_score: number; // 0-100
  risk_level: 'low' | 'medium' | 'high';
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
  submission_queue_id?: string;
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
  submission_queue_id?: string;
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
  submission_queue_id?: string;
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
  created_at: string;
  updated_at: string;
}

// NEW: KRA Submission Queue for offline-first approach
interface KRASubmissionQueue {
  id: string;
  taxpayer_id: string;
  return_type: 'VAT' | 'PAYE' | 'WHT';
  data: any;
  status: 'pending' | 'submitted' | 'failed' | 'retry';
  retry_count: number;
  error_message?: string;
  scheduled_submission: string;
  created_at: string;
  updated_at: string;
}

// NEW: Tax Audit Log for compliance tracking
interface TaxAuditLog {
  id: string;
  action: string;
  taxpayer_id: string;
  user_id?: string;
  before_data: any;
  after_data: any;
  timestamp: string;
  ip_address?: string;
  user_agent?: string;
}

// NEW: Compliance Score interface
interface ComplianceScore {
  score: number; // 0-100
  risk_level: 'low' | 'medium' | 'high';
  improvement_tips: string[];
  certificate_eligibility: boolean;
  factors: {
    timely_filing: number;
    payment_history: number;
    penalty_frequency: number;
    documentation_quality: number;
  };
}

// NEW: Monthly Tax Estimation
interface MonthlyTaxEstimate {
  estimated_vat: number;
  estimated_paye: number;
  estimated_wht: number;
  estimated_total: number;
  cash_flow_impact: number;
  recommendations: string[];
  next_payment_dates: { [key: string]: string };
}

// Initialize Supabase client
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const supabase = createClient(supabaseUrl, supabaseKey);

// Kenya Tax Constants (Enhanced)
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
  },
  // NEW: Penalty rates
  LATE_FILING_PENALTY_RATE: 0.05, // 5% of tax due
  DAILY_INTEREST_RATE: 0.01, // 1% per day
  VAT_REGISTRATION_THRESHOLD: 5000000 // KES 5M annual turnover
};

const PAYE_TAX_BANDS = [
  { min: 0, max: 24000, rate: 0.10 },
  { min: 24001, max: 32333, rate: 0.25 },
  { min: 32334, max: Infinity, rate: 0.30 }
];

// NEW: KRA Holidays for deadline calculations
const KRA_HOLIDAYS = [
  '2024-01-01', '2024-04-29', '2024-05-01', '2024-06-01', 
  '2024-10-20', '2024-12-12', '2024-12-25', '2024-12-26'
];

// Enhanced Utility functions
function generateId(): string {
  return crypto.randomUUID();
}

function validateKRAPIN(pin: string): { valid: boolean; error?: string } {
  const kraRegex = /^[A-Z]\d{9}[A-Z]$/;
  if (!pin) {
    return { valid: false, error: "KRA PIN haikupatikana! Ingiza PIN yako ya KRA." };
  }
  if (!kraRegex.test(pin)) {
    return { 
      valid: false, 
      error: "KRA PIN yapotea! Lazima iwe kama hii: A123456789B (herufi, nambari 9, herufi)" 
    };
  }
  return { valid: true };
}

// NEW: Enhanced date handling with KRA holidays and weekends
function adjustForWeekends(date: Date): Date {
  const adjusted = new Date(date);
  
  // If it falls on Saturday, move to Monday
  if (adjusted.getDay() === 6) {
    adjusted.setDate(adjusted.getDate() + 2);
  }
  // If it falls on Sunday, move to Monday
  else if (adjusted.getDay() === 0) {
    adjusted.setDate(adjusted.getDate() + 1);
  }
  
  // Check for KRA holidays
  const dateStr = adjusted.toISOString().split('T')[0];
  if (KRA_HOLIDAYS.includes(dateStr)) {
    adjusted.setDate(adjusted.getDate() + 1);
    return adjustForWeekends(adjusted); // Recursive check
  }
  
  return adjusted;
}

function getKRADeadline(taxType: string, period: Date): Date {
  const deadline = calculateNextDueDate(taxType, period);
  return adjustForWeekends(new Date(deadline));
}

// NEW: Calculate penalties automatically
function calculatePenalties(dueDate: string, currentDate: string, amount: number): number {
  const due = new Date(dueDate);
  const current = new Date(currentDate);
  const daysLate = Math.floor((current.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
  
  if (daysLate <= 0) return 0;
  
  // KRA penalty structure: 5% of tax due + 1% per day
  const basePenalty = amount * KENYA_TAX_RATES.LATE_FILING_PENALTY_RATE;
  const dailyInterest = daysLate * amount * (KENYA_TAX_RATES.DAILY_INTEREST_RATE / 100);
  
  return Math.round(basePenalty + dailyInterest);
}

// NEW: Calculate compliance score
async function calculateComplianceScore(taxpayerId: string): Promise<ComplianceScore> {
  // Get historical data
  const { data: obligations } = await supabase
    .from('tax_obligations')
    .select('*')
    .eq('taxpayer_id', taxpayerId);

  const { data: auditLogs } = await supabase
    .from('tax_audit_logs')
    .select('*')
    .eq('taxpayer_id', taxpayerId)
    .order('timestamp', { ascending: false })
    .limit(100);

  const currentDate = new Date();
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  // Calculate factors
  const recentObligations = obligations?.filter(o => 
    new Date(o.created_at) >= sixMonthsAgo
  ) || [];

  const timelyFiled = recentObligations.filter(o => 
    o.status === 'paid' && new Date(o.updated_at) <= new Date(o.due_date)
  ).length;

  const totalObligations = recentObligations.length || 1;
  const timelyFilingScore = (timelyFiled / totalObligations) * 100;

  const totalPenalties = obligations?.reduce((sum, o) => sum + o.penalties, 0) || 0;
  const penaltyScore = Math.max(0, 100 - (totalPenalties / 10000)); // Reduce score based on penalties

  const overdue = obligations?.filter(o => 
    new Date(o.due_date) < currentDate && o.status !== 'paid'
  ).length || 0;

  const paymentHistoryScore = Math.max(0, 100 - (overdue * 20));

  const documentationScore = auditLogs?.length > 10 ? 90 : 70; // Based on activity

  const factors = {
    timely_filing: Math.round(timelyFilingScore),
    payment_history: Math.round(paymentHistoryScore),
    penalty_frequency: Math.round(penaltyScore),
    documentation_quality: documentationScore
  };

  const overallScore = Math.round(
    (factors.timely_filing * 0.3) +
    (factors.payment_history * 0.4) +
    (factors.penalty_frequency * 0.2) +
    (factors.documentation_quality * 0.1)
  );

  let riskLevel: 'low' | 'medium' | 'high' = 'low';
  if (overallScore < 50) riskLevel = 'high';
  else if (overallScore < 75) riskLevel = 'medium';

  const improvementTips = [];
  if (factors.timely_filing < 80) improvementTips.push("File tax returns before due dates");
  if (factors.payment_history < 80) improvementTips.push("Pay all outstanding tax obligations");
  if (factors.penalty_frequency < 80) improvementTips.push("Set up payment reminders to avoid penalties");
  if (overdue > 0) improvementTips.push("Clear all overdue obligations immediately");

  return {
    score: overallScore,
    risk_level: riskLevel,
    improvement_tips: improvementTips,
    certificate_eligibility: overallScore >= 75 && overdue === 0,
    factors
  };
}

// NEW: Log audit trail
async function logAuditTrail(
  action: string,
  taxpayerId: string,
  beforeData: any,
  afterData: any,
  userId?: string,
  ipAddress?: string
): Promise<void> {
  const auditLog: TaxAuditLog = {
    id: generateId(),
    action,
    taxpayer_id: taxpayerId,
    user_id: userId,
    before_data: beforeData,
    after_data: afterData,
    timestamp: new Date().toISOString(),
    ip_address: ipAddress
  };

  await supabase.from('tax_audit_logs').insert([auditLog]);
}

// Existing utility functions (enhanced with error handling)
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
  const pensionablePay = Math.min(grossPay, 18000);
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
  const nextMonth = new Date(currentDate);
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  
  switch (obligationType) {
    case 'VAT':
    case 'PAYE':
    case 'WHT':
      nextMonth.setDate(20);
      break;
    case 'CORPORATION_TAX':
      nextMonth.setMonth(nextMonth.getMonth() + 5);
      nextMonth.setDate(30);
      break;
    default:
      nextMonth.setDate(20);
  }
  
  return nextMonth.toISOString().split('T')[0];
}

// Enhanced MCP Tools
const tools = [
  // Existing tools remain the same but with enhanced error handling...
  {
    name: "register_taxpayer",
    description: "Register a new taxpayer with KRA details - supports Swahili error messages",
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

  // NEW: SME-Friendly Features
  {
    name: "estimate_monthly_taxes",
    description: "Quick tax estimate for planning - perfect for Finji users who need to plan cash flow",
    inputSchema: {
      type: "object",
      properties: {
        monthly_revenue: { type: "number", description: "Expected monthly revenue in KES" },
        monthly_expenses: { type: "number", description: "Expected monthly expenses in KES" },
        employee_count: { type: "number", description: "Number of employees" },
        average_salary: { type: "number", description: "Average employee salary" },
        business_type: { 
          type: "string", 
          enum: ["individual", "partnership", "company", "trust", "cooperative"],
          description: "Type of business entity" 
        },
        is_vat_registered: { type: "boolean", description: "VAT registration status" },
        has_withholding_payments: { type: "boolean", description: "Do you make payments subject to WHT?" }
      },
      required: ["monthly_revenue", "monthly_expenses", "business_type", "is_vat_registered"]
    }
  },

  {
    name: "sync_payments_to_tax",
    description: "Match M-Pesa/bank payments to tax obligations - bridges with Finji's payment tracking",
    inputSchema: {
      type: "object",
      properties: {
        taxpayer_id: { type: "string", description: "Taxpayer ID" },
        payment_reference: { type: "string", description: "M-Pesa or bank transaction reference" },
        amount: { type: "number", description: "Payment amount" },
        payment_date: { type: "string", description: "Payment date (YYYY-MM-DD)" },
        payment_method: { 
          type: "string", 
          enum: ["mpesa", "bank_transfer", "cheque", "cash"],
          description: "Payment method used" 
        },
        tax_type: { 
          type: "string", 
          enum: ["VAT", "PAYE", "WHT", "CORPORATION_TAX"],
          description: "Type of tax being paid (optional - will auto-detect)" 
        }
      },
      required: ["taxpayer_id", "payment_reference", "amount", "payment_date", "payment_method"]
    }
  },

  {
    name: "get_compliance_score",
    description: "Get detailed compliance scoring and recommendations for improvement",
    inputSchema: {
      type: "object",
      properties: {
        taxpayer_id: { type: "string", description: "Taxpayer ID" }
      },
      required: ["taxpayer_id"]
    }
  },

  {
    name: "queue_kra_submission",
    description: "Queue tax returns for submission to KRA (offline-first approach)",
    inputSchema: {
      type: "object",
      properties: {
        taxpayer_id: { type: "string", description: "Taxpayer ID" },
        return_type: { 
          type: "string", 
          enum: ["VAT", "PAYE", "WHT"],
          description: "Type of return to submit" 
        },
        return_id: { type: "string", description: "ID of the return to submit" },
        scheduled_date: { type: "string", description: "When to submit (YYYY-MM-DD HH:mm)" }
      },
      required: ["taxpayer_id", "return_type", "return_id"]
    }
  },

  {
    name: "check_vat_registration_requirement",
    description: "Check if business needs to register for VAT based on turnover",
    inputSchema: {
      type: "object",
      properties: {
        annual_turnover: { type: "number", description: "Annual turnover in KES" },
        business_type: { type: "string", description: "Type of business" },
        projected_growth: { type: "number", description: "Expected growth percentage (optional)" }
      },
      required: ["annual_turnover", "business_type"]
    }
  },

  {
    name: "generate_tax_calendar",
    description: "Generate personalized tax calendar with all due dates and reminders",
    inputSchema: {
      type: "object",
      properties: {
        taxpayer_id: { type: "string", description: "Taxpayer ID" },
        year: { type: "number", description: "Year for calendar generation" },
        reminder_days: { type: "number", description: "Days before due date to remind", default: 7 }
      },
      required: ["taxpayer_id", "year"]
    }
  },

  {
    name: "simulate_tax_scenarios",
    description: "Simulate different business scenarios and their tax implications",
    inputSchema: {
      type: "object",
      properties: {
        base_revenue: { type: "number", description: "Current monthly revenue" },
        scenarios: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              revenue_change: { type: "number", description: "Percentage change in revenue" },
              expense_change: { type: "number", description: "Percentage change in expenses" },
              employee_change: { type: "number", description: "Change in number of employees" }
            }
          }
        }
      },
      required: ["base_revenue", "scenarios"]
    }
  },

  // Enhanced existing tools with better error handling
  {
    name: "file_vat_return",
    description: "File a VAT return for a specific period with enhanced validation",
    inputSchema: {
      type: "object",
      properties: {
        taxpayer_id: { type: "string", description: "Taxpayer ID" },
        period_month: { type: "number", description: "Month (1-12)" },
        period_year: { type: "number", description: "Year" },
        taxable_supplies: { type: "number", description: "Total taxable supplies" },
        taxable_purchases: { type: "number", description: "Total taxable purchases" },
        imported_services: { type: "number", description: "Imported services value" },
        auto_calculate_penalties: { type: "boolean", description: "Auto-calculate penalties if late", default: true }
      },
      required: ["taxpayer_id", "period_month", "period_year", "taxable_supplies", "taxable_purchases"]
    }
  },

  {
    name: "file_paye_return",
    description: "File a PAYE return with employee details and automatic calculations",
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
        auto_calculate_penalties: { type: "boolean", description: "Auto-calculate penalties if late", default: true }
      },
      required: ["taxpayer_id", "period_month", "period_year", "employees"]
    }
  },

  // Continue with other enhanced existing tools...
  {
    name: "get_tax_obligations",
    description: "Get all tax obligations for a taxpayer with enhanced filtering",
    inputSchema: {
      type: "object",
      properties: {
        taxpayer_id: { type: "string", description: "Taxpayer ID" },
        status: { 
          type: "string", 
          enum: ["pending", "filed", "paid", "overdue", "defaulted"],
          description: "Filter by obligation status (optional)" 
        },
        include_penalties: { type: "boolean", description: "Include penalty calculations", default: true },
        language: { type: "string", enum: ["en", "sw"], description: "Response language", default: "en" }
      },
      required: ["taxpayer_id"]
    }
  }
];

// Enhanced Tool handlers with better error handling
async function handleTool(name: string, args: any): Promise<any> {
  try {
    switch (name) {
      case "register_taxpayer": {
        // Enhanced KRA PIN validation
        const pinValidation = validateKRAPIN(args.kra_pin);
        if (!pinValidation.valid) {
          return {
            content: [{
              type: "text",
              text: `❌ ${pinValidation.error}`
            }],
            isError: true
          };
        }

        // Check for existing taxpayer
        const { data: existing } = await supabase
          .from('taxpayers')
          .select('id, business_name')
          .eq('kra_pin', args.kra_pin.toUpperCase())
          .single();

        if (existing) {
          return {
            content: [{
              type: "text",
              text: `❌ Mnunuzi tayari amesajiliwa! ${existing.business_name} anatumia KRA PIN hii.`
            }],
            isError: true
          };
        }

        // Auto-determine VAT registration requirement
        const vatRequired = args.annual_turnover && args.annual_turnover >= KENYA_TAX_RATES.VAT_REGISTRATION_THRESHOLD;
        if (vatRequired && !args.is_vat_registered) {
          return {
            content: [{
              type: "text",
              text: `⚠️ Mauzo yako ya mwaka (KES ${args.annual_turnover.toLocaleString()}) yanazidi KES 5M. Lazima ujisajili kwa VAT!`
            }],
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
          compliance_score: 85, // Start with good score
          risk_level: 'low',
          created_at: new Date().toISOString()
        };

        const { data, error } = await supabase
          .from('taxpayers')
          .insert([taxpayer])
          .select()
          .single();
        
        if (error) throw error;

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
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          });
        }

        if (obligations.length > 0) {
          await supabase.from('tax_obligations').insert(obligations);
        }

        // Log audit trail
        await logAuditTrail('TAXPAYER_REGISTERED', data.id, null, data);

        return {
          content: [{
            type: "text",
            text: `✅ Umefanikiwa kusajili biashara! 🎉\n\n` +
                  `📋 Jina la Biashara: ${data.business_name}\n` +
                  `🆔 KRA PIN: ${data.kra_pin}\n` +
                  `💼 Aina ya Biashara: ${data.business_type}\n` +
                  `📊 Compliance Score: ${data.compliance_score}/100\n` +
                  `🚨 Risk Level: ${data.risk_level}\n\n` +
                  `Majukumu ya Ushuru: ${args.tax_obligations.join(', ')}\n\n` +
                  `🔔 Finji itakukumbusha tarehe za kulipa ushuru!`
          }]
        };
      }

      case "estimate_monthly_taxes": {
        const estimate: MonthlyTaxEstimate = {
          estimated_vat: 0,
          estimated_paye: 0,
          estimated_wht: 0,
          estimated_total: 0,
          cash_flow_impact: 0,
          recommendations: [],
          next_payment_dates: {}
        };

        // VAT Calculation
        if (args.is_vat_registered) {
          const netSales = args.monthly_revenue - args.monthly_expenses;
          estimate.estimated_vat = Math.max(0, netSales * KENYA_TAX_RATES.VAT_STANDARD);
          const nextVATDate = getKRADeadline('VAT', new Date());
          estimate.next_payment_dates['VAT'] = nextVATDate.toISOString().split('T')[0];
        }

        // PAYE Calculation
        if (args.employee_count && args.average_salary) {
          const totalPayroll = args.employee_count * args.average_salary;
          const averageNSSF = calculateNSSF(args.average_salary);
          const averagePAYE = calculatePAYE(args.average_salary, averageNSSF);
          estimate.estimated_paye = args.employee_count * averagePAYE;
          
          const nextPAYEDate = getKRADeadline('PAYE', new Date());
          estimate.next_payment_dates['PAYE'] = nextPAYEDate.toISOString().split('T')[0];
        }

        // WHT Calculation (simplified)
        if (args.has_withholding_payments) {
          const estimatedWHTPayments = args.monthly_expenses * 0.2; // Assume 20% of expenses subject to WHT
          estimate.estimated_wht = estimatedWHTPayments * 0.05; // Average 5% rate
          
          const nextWHTDate = getKRADeadline('WHT', new Date());
          estimate.next_payment_dates['WHT'] = nextWHTDate.toISOString().split('T')[0];
        }

        estimate.estimated_total = estimate.estimated_vat + estimate.estimated_paye + estimate.estimated_wht;
        estimate.cash_flow_impact = (estimate.estimated_total / args.monthly_revenue) * 100;

        // Generate recommendations
        if (estimate.cash_flow_impact > 15) {
          estimate.recommendations.push("⚠️ Ushuru unaathiri mtiririko wa fedha zaidi ya 15%. Panga vizuri!");
        }
        
        if (!args.is_vat_registered && args.monthly_revenue * 12 > KENYA_TAX_RATES.VAT_REGISTRATION_THRESHOLD) {
          estimate.recommendations.push("💡 Mauzo yako yanakaribia KES 5M. Jiandae kujisajili kwa VAT!");
        }

        if (estimate.estimated_paye > 50000) {
          estimate.recommendations.push("📊 PAYE yako ni kubwa. Fikiria pension contributions kupunguza ushuru.");
        }

        estimate.recommendations.push("💰 Weka akiba kwa ajili ya ushuru - 20% ya mapato yako.");
        estimate.recommendations.push("📅 Tumia Finji kukumbushwa kabla ya tarehe za kulipa.");

        return {
          content: [{
            type: "text",
            text: `📊 MAKADIRIO YA USHURU WA MWEZI\n\n` +
                  `💰 Mapato ya Mwezi: KES ${args.monthly_revenue.toLocaleString()}\n` +
                  `💸 Matumizi ya Mwezi: KES ${args.monthly_expenses.toLocaleString()}\n\n` +
                  `📋 USHURU UNATARAJIWA:\n` +
                  `• VAT: KES ${estimate.estimated_vat.toLocaleString()}\n` +
                  `• PAYE: KES ${estimate.estimated_paye.toLocaleString()}\n` +
                  `• WHT: KES ${estimate.estimated_wht.toLocaleString()}\n` +
                  `• JUMLA: KES ${estimate.estimated_total.toLocaleString()}\n\n` +
                  `📈 Athari kwa Mtiririko wa Fedha: ${estimate.cash_flow_impact.toFixed(1)}%\n\n` +
                  `🗓️ TAREHE ZA KULIPA:\n` +
                  Object.entries(estimate.next_payment_dates)
                    .map(([type, date]) => `• ${type}: ${date}`)
                    .join('\n') + '\n\n' +
                  `💡 MAPENDEKEZO:\n` +
                  estimate.recommendations.map(r => `${r}`).join('\n')
          }]
        };
      }

      case "sync_payments_to_tax": {
        // Find matching tax obligations
        const { data: obligations } = await supabase
          .from('tax_obligations')
          .select('*')
          .eq('taxpayer_id', args.taxpayer_id)
          .eq('status', 'pending')
          .order('due_date', { ascending: true });

        if (!obligations || obligations.length === 0) {
          return {
            content: [{
              type: "text",
              text: `ℹ️ Hakuna madeni ya ushuru yanayosubiri malipo kwa sasa.`
            }]
          };
        }

        // Try to match payment to specific tax type or auto-detect
        let matchedObligation = null;
        
        if (args.tax_type) {
          matchedObligation = obligations.find(o => o.obligation_type === args.tax_type);
        } else {
          // Auto-detect based on amount (closest match)
          matchedObligation = obligations.reduce((prev, curr) => 
            Math.abs(curr.amount_due - args.amount) < Math.abs(prev.amount_due - args.amount) ? curr : prev
          );
        }

        if (!matchedObligation) {
          return {
            content: [{
              type: "text",
              text: `❌ Hakuna deni la ushuru linalolingana na kiasi cha KES ${args.amount.toLocaleString()}`
            }],
            isError: true
          };
        }

        // Update payment status
        const { data: updatedObligation, error } = await supabase
          .from('tax_obligations')
          .update({
            amount_paid: args.amount,
            status: args.amount >= matchedObligation.amount_due ? 'paid' : 'pending',
            updated_at: new Date().toISOString()
          })
          .eq('id', matchedObligation.id)
          .select()
          .single();

        if (error) throw error;

        // Log audit trail
        await logAuditTrail(
          'PAYMENT_SYNCED', 
          args.taxpayer_id, 
          matchedObligation, 
          updatedObligation
        );

        const isFullyPaid = args.amount >= matchedObligation.amount_due;
        const remainingBalance = Math.max(0, matchedObligation.amount_due - args.amount);

        return {
          content: [{
            type: "text",
            text: `✅ MALIPO YAMEHIFADHIWA! 💰\n\n` +
                  `📋 Aina ya Ushuru: ${matchedObligation.obligation_type}\n` +
                  `💳 Njia ya Malipo: ${args.payment_method.toUpperCase()}\n` +
                  `🔢 Reference: ${args.payment_reference}\n` +
                  `💰 Kiasi: KES ${args.amount.toLocaleString()}\n` +
                  `📅 Tarehe: ${args.payment_date}\n\n` +
                  `${isFullyPaid ? 
                    '🎉 Umelipa kikamilifu! Hongera!' : 
                    `⚠️ Baki: KES ${remainingBalance.toLocaleString()}`
                  }\n\n` +
                  `${isFullyPaid ? 
                    '📜 Unastahili Certificate of Tax Compliance!' : 
                    '💡 Maliza malipo ya deni hili kupata Certificate.'
                  }`
          }]
        };
      }

      case "get_compliance_score": {
        const complianceScore = await calculateComplianceScore(args.taxpayer_id);
        
        const { data: taxpayer } = await supabase
          .from('taxpayers')
          .select('business_name, kra_pin')
          .eq('id', args.taxpayer_id)
          .single();

        // Update taxpayer record with new compliance score
        await supabase
          .from('taxpayers')
          .update({
            compliance_score: complianceScore.score,
            risk_level: complianceScore.risk_level
          })
          .eq('id', args.taxpayer_id);

        let scoreEmoji = '🔴';
        if (complianceScore.score >= 75) scoreEmoji = '🟢';
        else if (complianceScore.score >= 50) scoreEmoji = '🟡';

        return {
          content: [{
            type: "text",
            text: `${scoreEmoji} COMPLIANCE SCORE REPORT\n\n` +
                  `🏢 Biashara: ${taxpayer?.business_name}\n` +
                  `🆔 KRA PIN: ${taxpayer?.kra_pin}\n\n` +
                  `📊 OVERALL SCORE: ${complianceScore.score}/100\n` +
                  `🚨 Risk Level: ${complianceScore.risk_level.toUpperCase()}\n` +
                  `📜 Certificate Eligible: ${complianceScore.certificate_eligibility ? 'YES ✅' : 'NO ❌'}\n\n` +
                  `📈 DETAILED BREAKDOWN:\n` +
                  `• Timely Filing: ${complianceScore.factors.timely_filing}/100\n` +
                  `• Payment History: ${complianceScore.factors.payment_history}/100\n` +
                  `• Penalty Record: ${complianceScore.factors.penalty_frequency}/100\n` +
                  `• Documentation: ${complianceScore.factors.documentation_quality}/100\n\n` +
                  `💡 IMPROVEMENT TIPS:\n` +
                  complianceScore.improvement_tips.map(tip => `• ${tip}`).join('\n') +
                  `\n\n🎯 NEXT STEPS:\n` +
                  `${complianceScore.certificate_eligibility ? 
                    '• Apply for Tax Compliance Certificate\n• Maintain current good standing' :
                    '• Clear all overdue obligations\n• Set up payment reminders\n• Contact KRA if needed'
                  }`
          }]
        };
      }

      case "queue_kra_submission": {
        // Get the return data
        let returnData = null;
        const tableName = args.return_type.toLowerCase() + '_returns';
        
        const { data, error: fetchError } = await supabase
          .from(tableName)
          .select('*')
          .eq('id', args.return_id)
          .single();

        if (fetchError || !data) {
          return {
            content: [{
              type: "text",
              text: `❌ Return haijaweza kupatikana. Hakikisha ID ni sahihi.`
            }],
            isError: true
          };
        }

        const submissionQueue: KRASubmissionQueue = {
          id: generateId(),
          taxpayer_id: args.taxpayer_id,
          return_type: args.return_type,
          data: data,
          status: 'pending',
          retry_count: 0,
          scheduled_submission: args.scheduled_date || new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };

        const { data: queuedSubmission, error } = await supabase
          .from('kra_submission_queue')
          .insert([submissionQueue])
          .select()
          .single();

        if (error) throw error;

        // Update the return with queue reference
        await supabase
          .from(tableName)
          .update({ submission_queue_id: queuedSubmission.id })
          .eq('id', args.return_id);

        return {
          content: [{
            type: "text",
            text: `📋 RETURN IMEPANGWA KWA KRA! ⏰\n\n` +
                  `📊 Aina: ${args.return_type}\n` +
                  `🆔 Queue ID: ${queuedSubmission.id}\n` +
                  `⏰ Itakupatikana: ${submissionQueue.scheduled_submission}\n` +
                  `📱 Status: Inasubiri\n\n` +
                  `✅ Finji itakujulisha iwapo return imepatikana kikamilifu!\n` +
                  `🔄 Kama hakuna internet, return itasubiriwa na kupatiwa baadaye.`
          }]
        };
      }

      case "check_vat_registration_requirement": {
        const threshold = KENYA_TAX_RATES.VAT_REGISTRATION_THRESHOLD;
        const isRequired = args.annual_turnover >= threshold;
        const percentageOfThreshold = (args.annual_turnover / threshold) * 100;
        
        let projectedTurnover = args.annual_turnover;
        if (args.projected_growth) {
          projectedTurnover = args.annual_turnover * (1 + args.projected_growth / 100);
        }
        
        const willRequireNext = projectedTurnover >= threshold;

        return {
          content: [{
            type: "text",
            text: `📊 VAT REGISTRATION CHECK\n\n` +
                  `💰 Current Turnover: KES ${args.annual_turnover.toLocaleString()}\n` +
                  `🎯 VAT Threshold: KES ${threshold.toLocaleString()}\n` +
                  `📈 You're at: ${percentageOfThreshold.toFixed(1)}% of threshold\n\n` +
                  `${isRequired ? 
                    '🚨 VAT REGISTRATION REQUIRED!\n' +
                    '• You MUST register for VAT immediately\n' +
                    '• Contact KRA or visit iTax portal\n' +
                    '• Start charging 16% VAT on sales\n' +
                    '• File monthly VAT returns' :
                    `✅ VAT Registration: Not Required\n` +
                    `• You're ${((threshold - args.annual_turnover) / 1000000).toFixed(1)}M below threshold\n` +
                    `• Monitor your growth closely`
                  }\n\n` +
                  `${args.projected_growth ? 
                    `🔮 PROJECTION (${args.projected_growth}% growth):\n` +
                    `Next Year: KES ${projectedTurnover.toLocaleString()}\n` +
                    `${willRequireNext && !isRequired ? 
                      '⚠️ You will need VAT registration next year!' : 
                      willRequireNext ? 
                        '✅ Will continue requiring VAT' : 
                        '✅ Will remain below threshold'
                    }` : ''
                  }\n\n` +
                  `💡 RECOMMENDATIONS:\n` +
                  `${isRequired ? 
                    '• Register for VAT within 30 days\n• Update all invoices to include VAT\n• Set up VAT tracking in Finji' :
                    '• Track monthly sales to monitor threshold\n• Plan for VAT registration if growing\n• Consider voluntary registration benefits'
                  }`
          }]
        };
      }

      case "generate_tax_calendar": {
        const year = args.year;
        const reminderDays = args.reminder_days || 7;
        
        // Get taxpayer obligations
        const { data: taxpayer } = await supabase
          .from('taxpayers')
          .select('tax_obligations, business_name')
          .eq('id', args.taxpayer_id)
          .single();

        if (!taxpayer) {
          return {
            content: [{
              type: "text",
              text: `❌ Mnunuzi hajapatikana.`
            }],
            isError: true
          };
        }

        const calendar = [];
        const months = [
          'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
          'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
        ];

        // Generate calendar for each obligation type
        for (const obligation of taxpayer.tax_obligations) {
          for (let month = 1; month <= 12; month++) {
            const dueDate = new Date(year, month, 20); // Most taxes due on 20th
            const adjustedDue = adjustForWeekends(dueDate);
            const reminderDate = new Date(adjustedDue);
            reminderDate.setDate(reminderDate.getDate() - reminderDays);

            calendar.push({
              month: months[month - 1],
              obligation: obligation,
              due_date: adjustedDue.toISOString().split('T')[0],
              reminder_date: reminderDate.toISOString().split('T')[0],
              period: `${months[month - 1]} ${year}`
            });
          }
        }

        // Group by month
        const groupedCalendar = calendar.reduce((acc, item) => {
          const month = item.month;
          if (!acc[month]) acc[month] = [];
          acc[month].push(item);
          return acc;
        }, {} as any);

        let calendarText = `📅 KALENDA YA USHURU ${year}\n`;
        calendarText += `🏢 ${taxpayer.business_name}\n\n`;

        for (const [month, items] of Object.entries(groupedCalendar)) {
          calendarText += `📅 ${month.toUpperCase()} ${year}\n`;
          for (const item of items as any[]) {
            calendarText += `  • ${item.obligation}: ${item.due_date}\n`;
            calendarText += `    📢 Reminder: ${item.reminder_date}\n`;
          }
          calendarText += '\n';
        }

        calendarText += `🔔 VIKUMBUSHO:\n`;
        calendarText += `• Finji itakutumia WhatsApp ${reminderDays} siku kabla\n`;
        calendarText += `• Weka akiba 20% ya mapato kwa ushuru\n`;
        calendarText += `• Tunza rekodi zote za biashara\n`;
        calendarText += `• Lipa mapema kuepuka faini`;

        return {
          content: [{
            type: "text",
            text: calendarText
          }]
        };
      }

      case "simulate_tax_scenarios": {
        const baseRevenue = args.base_revenue;
        const baseExpenses = baseRevenue * 0.6; // Assume 60% expense ratio
        const baseEmployees = 2; // Default assumption
        const results = [];

        for (const scenario of args.scenarios) {
          const newRevenue = baseRevenue * (1 + scenario.revenue_change / 100);
          const newExpenses = baseExpenses * (1 + scenario.expense_change / 100);
          const newEmployees = baseEmployees + (scenario.employee_change || 0);

          // Calculate taxes for this scenario
          const vatImpact = (newRevenue - newExpenses) * KENYA_TAX_RATES.VAT_STANDARD;
          const payeImpact = newEmployees * calculatePAYE(50000, calculateNSSF(50000)); // Assume 50k salary
          const totalTax = vatImpact + payeImpact;
          const netProfit = newRevenue - newExpenses - totalTax;
          const taxRate = (totalTax / newRevenue) * 100;

          results.push({
            scenario_name: scenario.name,
            revenue: newRevenue,
            expenses: newExpenses,
            employees: newEmployees,
            vat_liability: vatImpact,
            paye_liability: payeImpact,
            total_tax: totalTax,
            net_profit: netProfit,
            effective_tax_rate: taxRate
          });
        }

        let resultText = `📊 SIMULATION YA USHURU\n\n`;
        resultText += `💰 Base Revenue: KES ${baseRevenue.toLocaleString()}\n\n`;

        for (const result of results) {
          resultText += `🎬 SCENARIO: ${result.scenario_name}\n`;
          resultText += `  💰 Revenue: KES ${result.revenue.toLocaleString()}\n`;
          resultText += `  💸 Expenses: KES ${result.expenses.toLocaleString()}\n`;
          resultText += `  👥 Employees: ${result.employees}\n`;
          resultText += `  📊 Total Tax: KES ${result.total_tax.toLocaleString()}\n`;
          resultText += `  💵 Net Profit: KES ${result.net_profit.toLocaleString()}\n`;
          resultText += `  📈 Tax Rate: ${result.effective_tax_rate.toFixed(1)}%\n\n`;
        }

        // Find best and worst scenarios
        const bestScenario = results.reduce((prev, current) => 
          current.net_profit > prev.net_profit ? current : prev
        );
        const worstScenario = results.reduce((prev, current) => 
          current.net_profit < prev.net_profit ? current : prev
        );

        resultText += `🏆 BEST SCENARIO: ${bestScenario.scenario_name}\n`;
        resultText += `   Profit: KES ${bestScenario.net_profit.toLocaleString()}\n\n`;
        resultText += `⚠️ WORST SCENARIO: ${worstScenario.scenario_name}\n`;
        resultText += `   Profit: KES ${worstScenario.net_profit.toLocaleString()}\n\n`;
        resultText += `💡 Plan wisely and save for tax obligations!`;

        return {
          content: [{
            type: "text",
            text: resultText
          }]
        };
      }

      case "file_vat_return": {
        // Enhanced VAT return filing with penalty calculation
        const currentDate = new Date();
        const dueDate = getKRADeadline('VAT', new Date(args.period_year, args.period_month - 1));
        
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
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };

        // Calculate net VAT due
        vatReturn.net_vat_due = Math.max(0, 
          vatReturn.vat_on_supplies + vatReturn.vat_on_imported_services - vatReturn.vat_on_purchases
        );

        // Calculate penalties if late and auto-calculate is enabled
        if (args.auto_calculate_penalties && currentDate > dueDate) {
          vatReturn.penalties = calculatePenalties(
            vatReturn.due_date, 
            currentDate.toISOString().split('T')[0], 
            vatReturn.net_vat_due
          );
        }

        vatReturn.total_due = vatReturn.net_vat_due + vatReturn.penalties + vatReturn.interest;

        const { data, error } = await supabase
          .from('vat_returns')
          .insert([vatReturn])
          .select()
          .single();
        
        if (error) throw error;

        // Log audit trail
        await logAuditTrail('VAT_RETURN_FILED', args.taxpayer_id, null, data);

        const isLate = currentDate > dueDate;
        const daysLate = isLate ? Math.floor((currentDate.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24)) : 0;

        return {
          content: [{
            type: "text",
            text: `✅ VAT RETURN IMEFAILIWA! 📊\n\n` +
                  `📅 Period: ${args.period_month}/${args.period_year}\n` +
                  `💰 Taxable Supplies: KES ${args.taxable_supplies.toLocaleString()}\n` +
                  `💸 Taxable Purchases: KES ${args.taxable_purchases.toLocaleString()}\n` +
                  `📊 VAT on Supplies: KES ${vatReturn.vat_on_supplies.toLocaleString()}\n` +
                  `📉 VAT on Purchases: KES ${vatReturn.vat_on_purchases.toLocaleString()}\n` +
                  `💵 Net VAT Due: KES ${vatReturn.net_vat_due.toLocaleString()}\n` +
                  `${vatReturn.penalties > 0 ? `⚠️ Penalties: KES ${vatReturn.penalties.toLocaleString()}\n` : ''}` +
                  `🎯 TOTAL DUE: KES ${vatReturn.total_due.toLocaleString()}\n\n` +
                  `📅 Due Date: ${vatReturn.due_date}\n` +
                  `${isLate ? `🚨 LATE BY ${daysLate} DAYS!\n` : '✅ Filed on time!\n'}` +
                  `🆔 Return ID: ${data.id}\n\n` +
                  `📝 NEXT STEPS:\n` +
                  `• Pay KES ${vatReturn.total_due.toLocaleString()} before due date\n` +
                  `• Keep receipt for compliance\n` +
                  `• Update Finji when payment is made
