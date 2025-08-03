// Finji Analytics MCP Server - Edge Function
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Types for Finji Analytics
interface BusinessMetrics {
  business_id: string;
  period_start: string;
  period_end: string;
  total_revenue: number;
  total_expenses: number;
  net_profit: number;
  gross_margin: number;
  transaction_count: number;
  avg_transaction_value: number;
  cash_flow: number;
  outstanding_invoices: number;
  overdue_invoices: number;
  top_expense_categories: ExpenseCategory[];
  revenue_trend: TrendData[];
  expense_trend: TrendData[];
  payment_method_breakdown: PaymentMethodData[];
  created_at: string;
}

interface ExpenseCategory {
  category: string;
  amount: number;
  percentage: number;
  transaction_count: number;
  trend: 'increasing' | 'decreasing' | 'stable';
}

interface TrendData {
  date: string;
  amount: number;
  transaction_count: number;
}

interface PaymentMethodData {
  method: 'mpesa' | 'bank_transfer' | 'cash' | 'airtel_money' | 'other';
  amount: number;
  percentage: number;
  transaction_count: number;
}

interface CashFlowAlert {
  id: string;
  business_id: string;
  alert_type: 'low_balance' | 'overdue_invoice' | 'unusual_expense' | 'large_payment_due' | 'revenue_drop';
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  message: string;
  amount?: number;
  due_date?: string;
  recommended_action: string;
  is_read: boolean;
  created_at: string;
}

interface FraudAlert {
  id: string;
  business_id: string;
  transaction_id?: string;
  fraud_type: 'duplicate_transaction' | 'unusual_amount' | 'off_hours_transaction' | 'suspicious_vendor' | 'location_anomaly';
  risk_score: number; // 0-100
  description: string;
  evidence: string[];
  status: 'pending' | 'reviewed' | 'false_positive' | 'confirmed';
  created_at: string;
}

interface BusinessInsight {
  insight_type: 'opportunity' | 'warning' | 'trend' | 'comparison';
  title: string;
  description: string;
  impact: 'high' | 'medium' | 'low';
  action_required: boolean;
  suggested_actions: string[];
  data_points: any;
}

// Initialize Supabase client
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const supabase = createClient(supabaseUrl, supabaseKey);

// Gemini AI client
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')!;
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent';

// Kenya-specific business constants
const KENYA_TAX_RATES = {
  vat: 0.16,
  paye_bands: [
    { min: 0, max: 24000, rate: 0.1 },
    { min: 24001, max: 32333, rate: 0.25 },
    { min: 32334, max: Infinity, rate: 0.3 }
  ],
  turnover_tax: 0.03 // For businesses earning 1M-50M annually
};

const EXPENSE_CATEGORIES = {
  'inventory': ['stock', 'goods', 'merchandise', 'products'],
  'rent': ['rent', 'lease', 'premises'],
  'utilities': ['electricity', 'water', 'internet', 'phone'],
  'transport': ['fuel', 'matatu', 'uber', 'taxi', 'travel'],
  'marketing': ['advertising', 'promotion', 'marketing', 'social media'],
  'supplies': ['stationery', 'office', 'supplies', 'equipment'],
  'professional_services': ['lawyer', 'accountant', 'consultant', 'professional'],
  'insurance': ['insurance', 'cover', 'policy'],
  'licenses': ['license', 'permit', 'registration', 'compliance'],
  'maintenance': ['repair', 'maintenance', 'service', 'fix']
};

const FRAUD_THRESHOLDS = {
  large_transaction_multiplier: 5, // 5x average transaction
  off_hours_start: 22, // 10 PM
  off_hours_end: 6, // 6 AM
  duplicate_window_minutes: 30,
  suspicious_vendor_patterns: ['unknown', 'cash', 'untitled']
};

// Utility functions
function generateId(): string {
  return crypto.randomUUID();
}

function categorizeExpense(description: string): string {
  const desc = description.toLowerCase();
  
  for (const [category, keywords] of Object.entries(EXPENSE_CATEGORIES)) {
    if (keywords.some(keyword => desc.includes(keyword))) {
      return category;
    }
  }
  
  return 'other';
}

function detectFraudPatterns(transactions: any[], businessProfile: any): FraudAlert[] {
  const alerts: FraudAlert[] = [];
  const avgTransaction = transactions.reduce((sum, t) => sum + Math.abs(t.amount), 0) / transactions.length;
  
  transactions.forEach(transaction => {
    const fraudAlerts: Partial<FraudAlert>[] = [];
    
    // Large transaction detection
    if (Math.abs(transaction.amount) > avgTransaction * FRAUD_THRESHOLDS.large_transaction_multiplier) {
      fraudAlerts.push({
        fraud_type: 'unusual_amount',
        risk_score: 70,
        description: `Transaction amount KES ${transaction.amount.toLocaleString()} is ${Math.round(Math.abs(transaction.amount) / avgTransaction)}x larger than average`,
        evidence: [`Average transaction: KES ${avgTransaction.toLocaleString()}`, `This transaction: KES ${transaction.amount.toLocaleString()}`]
      });
    }
    
    // Off-hours detection
    const transactionHour = new Date(transaction.transaction_date).getHours();
    if (transactionHour >= FRAUD_THRESHOLDS.off_hours_start || transactionHour <= FRAUD_THRESHOLDS.off_hours_end) {
      fraudAlerts.push({
        fraud_type: 'off_hours_transaction',
        risk_score: 40,
        description: `Transaction made at ${transactionHour}:00 (outside normal business hours)`,
        evidence: [`Transaction time: ${transactionHour}:00`, 'Normal business hours: 6 AM - 10 PM']
      });
    }
    
    // Duplicate transaction detection
    const duplicates = transactions.filter(t => 
      t.id !== transaction.id && 
      Math.abs(t.amount) === Math.abs(transaction.amount) &&
      Math.abs(new Date(t.transaction_date).getTime() - new Date(transaction.transaction_date).getTime()) < FRAUD_THRESHOLDS.duplicate_window_minutes * 60 * 1000
    );
    
    if (duplicates.length > 0) {
      fraudAlerts.push({
        fraud_type: 'duplicate_transaction',
        risk_score: 80,
        description: `Potential duplicate transaction detected`,
        evidence: [`${duplicates.length} similar transactions within ${FRAUD_THRESHOLDS.duplicate_window_minutes} minutes`]
      });
    }
    
    // Convert to full alerts
    fraudAlerts.forEach(alert => {
      alerts.push({
        id: generateId(),
        business_id: businessProfile.id,
        transaction_id: transaction.id,
        fraud_type: alert.fraud_type!,
        risk_score: alert.risk_score!,
        description: alert.description!,
        evidence: alert.evidence!,
        status: 'pending',
        created_at: new Date().toISOString()
      });
    });
  });
  
  return alerts;
}

// AI-powered insight generation
async function generateAIInsights(businessData: any, language: 'en' | 'sw' = 'en'): Promise<BusinessInsight[]> {
  const prompt = language === 'sw' ? 
    `Wewe ni mshauri wa biashara wa Kenya. Tafadhali angalia data hii ya biashara na utoe ushauri wa kimauongozi:

Data ya Biashara:
- Mapato: KES ${businessData.revenue?.toLocaleString() || 0}
- Matumizi: KES ${businessData.expenses?.toLocaleString() || 0}
- Faida: KES ${businessData.profit?.toLocaleString() || 0}
- Madeni yasiyo yamelipwa: ${businessData.outstanding_invoices || 0}
- Aina za matumizi makubwa: ${JSON.stringify(businessData.top_expenses || [])}
- Njia za malipo: ${JSON.stringify(businessData.payment_methods || [])}

Toa maoni 2-3 ya muhimu zaidi kwa mfupi (kila moja pungufu ya maneno 50). Ongoza kama mshauri wa biashara anayejua mazingira ya Kenya.` :

    `You are a Kenyan business advisor. Analyze this SME business data and provide critical insights:

Business Data:
- Revenue: KES ${businessData.revenue?.toLocaleString() || 0}
- Expenses: KES ${businessData.expenses?.toLocaleString() || 0}
- Profit: KES ${businessData.profit?.toLocaleString() || 0}
- Outstanding Invoices: ${businessData.outstanding_invoices || 0}
- Top Expense Categories: ${JSON.stringify(businessData.top_expenses || [])}
- Payment Methods: ${JSON.stringify(businessData.payment_methods || [])}

Provide 2-3 most critical insights (max 50 words each). Focus on actionable advice for Kenyan SMEs.`;

  try {
    const response = await fetch(`${GEMINI_BASE_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: prompt }]
        }],
        generationConfig: {
          maxOutputTokens: 300, // Keep it short to control costs
          temperature: 0.7
        }
      })
    });

    if (!response.ok) {
      console.error('Gemini API error:', await response.text());
      return getFallbackInsights(businessData, language);
    }

    const result = await response.json();
    const aiText = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    // Parse AI insights into structured format
    const insights = parseAIInsights(aiText, businessData, language);
    return insights;

  } catch (error) {
    console.error('AI insight generation failed:', error);
    return getFallbackInsights(businessData, language);
  }
}

function parseAIInsights(aiText: string, businessData: any, language: 'en' | 'sw'): BusinessInsight[] {
  // Split AI response into individual insights
  const insightTexts = aiText.split('\n').filter(line => line.trim().length > 10);
  
  return insightTexts.slice(0, 3).map((text, index) => {
    // Determine insight type based on content
    let insightType: 'opportunity' | 'warning' | 'trend' = 'trend';
    let impact: 'high' | 'medium' | 'low' = 'medium';
    let actionRequired = false;

    const lowerText = text.toLowerCase();
    
    if (lowerText.includes('urgent') || lowerText.includes('critical') || lowerText.includes('danger') || 
        lowerText.includes('muhimu sana') || lowerText.includes('hatari')) {
      insightType = 'warning';
      impact = 'high';
      actionRequired = true;
    } else if (lowerText.includes('opportunity') || lowerText.includes('grow') || lowerText.includes('expand') ||
               lowerText.includes('fursa') || lowerText.includes('kuongeza')) {
      insightType = 'opportunity';
      impact = 'high';
    }

    return {
      insight_type: insightType,
      title: language === 'sw' ? `Maarifa ${index + 1}` : `AI Insight ${index + 1}`,
      description: text.trim(),
      impact,
      action_required: actionRequired,
      suggested_actions: extractActions(text, language),
      data_points: { source: 'ai_generated', business_context: businessData }
    };
  });
}

function extractActions(text: string, language: 'en' | 'sw'): string[] {
  // Simple action extraction based on common verbs
  const actions: string[] = [];
  const lowerText = text.toLowerCase();
  
  if (language === 'sw') {
    if (lowerText.includes('ongeza') || lowerText.includes('increase')) actions.push('Ongeza uuzaji');
    if (lowerText.includes('punguza') || lowerText.includes('reduce')) actions.push('Punguza gharama');
    if (lowerText.includes('fuata') || lowerText.includes('follow')) actions.push('Fuatilia madeni');
  } else {
    if (lowerText.includes('increase') || lowerText.includes('boost')) actions.push('Increase sales efforts');
    if (lowerText.includes('reduce') || lowerText.includes('cut')) actions.push('Reduce unnecessary expenses');
    if (lowerText.includes('follow') || lowerText.includes('collect')) actions.push('Follow up on payments');
    if (lowerText.includes('invest') || lowerText.includes('expand')) actions.push('Consider business expansion');
  }
  
  return actions.length > 0 ? actions : [language === 'sw' ? 'Chunguza zaidi' : 'Review and analyze further'];
}

function getFallbackInsights(businessData: any, language: 'en' | 'sw'): BusinessInsight[] {
  // Fallback insights when AI fails (no additional cost)
  const insights: BusinessInsight[] = [];
  
  if (businessData.profit < 0) {
    insights.push({
      insight_type: 'warning',
      title: language === 'sw' ? 'Biashara Inapoteza' : 'Business Making Losses',
      description: language === 'sw' ? 
        'Biashara yako inafanya hasara. Ni muhimu kupunguza gharama au kuongeza uuzaji.' :
        'Your business is making losses. Focus on reducing costs or increasing sales.',
      impact: 'high',
      action_required: true,
      suggested_actions: language === 'sw' ? 
        ['Punguza gharama zisizo muhimu', 'Ongeza juhudi za uuzaji'] :
        ['Cut non-essential expenses', 'Increase sales efforts'],
      data_points: businessData
    });
  }
  
  return insights;
}
  const insights: BusinessInsight[] = [];
  
  // Cash flow insights
  if (metrics.cash_flow < 0) {
    insights.push({
      insight_type: 'warning',
      title: 'Negative Cash Flow Detected',
      description: `Your cash flow is KES ${metrics.cash_flow.toLocaleString()}. This means you're spending more than you're earning.`,
      impact: 'high',
      action_required: true,
      suggested_actions: [
        'Review and reduce non-essential expenses',
        'Follow up on overdue invoices',
        'Consider offering early payment discounts',
        'Look for additional revenue streams'
      ],
      data_points: {
        cash_flow: metrics.cash_flow,
        revenue: metrics.total_revenue,
        expenses: metrics.total_expenses
      }
    });
  }
  
  // Revenue trend analysis
  if (metrics.revenue_trend.length >= 2) {
    const recentRevenue = metrics.revenue_trend.slice(-2);
    const growthRate = (recentRevenue[1].amount - recentRevenue[0].amount) / recentRevenue[0].amount;
    
    if (growthRate > 0.1) {
      insights.push({
        insight_type: 'opportunity',
        title: 'Strong Revenue Growth',
        description: `Your revenue grew by ${(growthRate * 100).toFixed(1)}% recently. Consider scaling your operations.`,
        impact: 'high',
        action_required: false,
        suggested_actions: [
          'Invest in inventory to meet growing demand',
          'Consider hiring additional staff',
          'Expand marketing efforts',
          'Plan for increased working capital needs'
        ],
        data_points: { growth_rate: growthRate, recent_revenue: recentRevenue }
      });
    } else if (growthRate < -0.1) {
      insights.push({
        insight_type: 'warning',
        title: 'Revenue Decline',
        description: `Your revenue dropped by ${Math.abs(growthRate * 100).toFixed(1)}% recently. Immediate attention required.`,
        impact: 'high',
        action_required: true,
        suggested_actions: [
          'Analyze what caused the revenue drop',
          'Reach out to existing customers',
          'Review pricing strategy',
          'Increase marketing and sales efforts'
        ],
        data_points: { growth_rate: growthRate, recent_revenue: recentRevenue }
      });
    }
  }
  
  // Overdue invoices insight
  if (metrics.overdue_invoices > 0) {
    const overdueAmount = invoices
      .filter(inv => inv.status === 'overdue')
      .reduce((sum, inv) => sum + inv.amount, 0);
    
    insights.push({
      insight_type: 'warning',
      title: 'Overdue Invoices Need Attention',
      description: `You have ${metrics.overdue_invoices} overdue invoices worth KES ${overdueAmount.toLocaleString()}.`,
      impact: 'medium',
      action_required: true,
      suggested_actions: [
        'Send payment reminders via WhatsApp',
        'Offer payment plans for large overdue amounts',
        'Consider factoring services for immediate cash',
        'Review credit terms for future customers'
      ],
      data_points: {
        overdue_count: metrics.overdue_invoices,
        overdue_amount: overdueAmount
      }
    });
  }
  
  // Expense category insights
  const topExpenseCategory = metrics.top_expense_categories[0];
  if (topExpenseCategory && topExpenseCategory.percentage > 40) {
    insights.push({
      insight_type: 'trend',
      title: `High ${topExpenseCategory.category} Expenses`,
      description: `${topExpenseCategory.category} represents ${topExpenseCategory.percentage.toFixed(1)}% of your expenses.`,
      impact: 'medium',
      action_required: false,
      suggested_actions: [
        `Review ${topExpenseCategory.category} suppliers for better rates`,
        'Consider bulk purchasing discounts',
        'Look for alternative suppliers',
        'Analyze if the expense level is justified by revenue'
      ],
      data_points: topExpenseCategory
    });
  }
  
  return insights;
}

function calculateBusinessMetrics(transactions: any[], invoices: any[], period: { start: string, end: string }): BusinessMetrics {
  const revenue = transactions
    .filter(t => t.amount > 0 && t.transaction_date >= period.start && t.transaction_date <= period.end)
    .reduce((sum, t) => sum + t.amount, 0);
  
  const expenses = Math.abs(transactions
    .filter(t => t.amount < 0 && t.transaction_date >= period.start && t.transaction_date <= period.end)
    .reduce((sum, t) => sum + t.amount, 0));
  
  const netProfit = revenue - expenses;
  const grossMargin = revenue > 0 ? ((revenue - expenses) / revenue) * 100 : 0;
  
  // Expense categorization
  const expenseCategories: { [key: string]: number } = {};
  transactions
    .filter(t => t.amount < 0 && t.transaction_date >= period.start && t.transaction_date <= period.end)
    .forEach(t => {
      const category = categorizeExpense(t.description || '');
      expenseCategories[category] = (expenseCategories[category] || 0) + Math.abs(t.amount);
    });
  
  const topExpenseCategories = Object.entries(expenseCategories)
    .map(([category, amount]) => ({
      category,
      amount,
      percentage: (amount / expenses) * 100,
      transaction_count: transactions.filter(t => 
        t.amount < 0 && 
        categorizeExpense(t.description || '') === category &&
        t.transaction_date >= period.start && 
        t.transaction_date <= period.end
      ).length,
      trend: 'stable' as const // Would need historical data for real trend
    }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);
  
  // Payment method breakdown
  const paymentMethods: { [key: string]: { amount: number, count: number } } = {};
  transactions
    .filter(t => t.transaction_date >= period.start && t.transaction_date <= period.end)
    .forEach(t => {
      const method = t.payment_method || 'other';
      if (!paymentMethods[method]) paymentMethods[method] = { amount: 0, count: 0 };
      paymentMethods[method].amount += Math.abs(t.amount);
      paymentMethods[method].count += 1;
    });
  
  const paymentMethodBreakdown = Object.entries(paymentMethods)
    .map(([method, data]) => ({
      method: method as any,
      amount: data.amount,
      percentage: (data.amount / (revenue + expenses)) * 100,
      transaction_count: data.count
    }));
  
  return {
    business_id: transactions[0]?.business_id || '',
    period_start: period.start,
    period_end: period.end,
    total_revenue: revenue,
    total_expenses: expenses,
    net_profit: netProfit,
    gross_margin: grossMargin,
    transaction_count: transactions.filter(t => 
      t.transaction_date >= period.start && t.transaction_date <= period.end
    ).length,
    avg_transaction_value: revenue / Math.max(1, transactions.filter(t => 
      t.amount > 0 && t.transaction_date >= period.start && t.transaction_date <= period.end
    ).length),
    cash_flow: netProfit,
    outstanding_invoices: invoices.filter(inv => inv.status === 'sent' || inv.status === 'overdue').length,
    overdue_invoices: invoices.filter(inv => inv.status === 'overdue').length,
    top_expense_categories: topExpenseCategories,
    revenue_trend: [], // Would be populated with historical data
    expense_trend: [], // Would be populated with historical data
    payment_method_breakdown: paymentMethodBreakdown,
    created_at: new Date().toISOString()
  };
}

// MCP Tools
const tools = [
  {
    name: "get_business_dashboard",
    description: "Get comprehensive business dashboard with key metrics",
    inputSchema: {
      type: "object",
      properties: {
        business_id: { type: "string", description: "Business ID" },
        period: { 
          type: "string", 
          enum: ["today", "week", "month", "quarter", "year", "custom"],
          description: "Time period for analysis" 
        },
        start_date: { type: "string", description: "Start date for custom period (YYYY-MM-DD)" },
        end_date: { type: "string", description: "End date for custom period (YYYY-MM-DD)" },
        language: { type: "string", enum: ["en", "sw"], description: "Response language" }
      },
      required: ["business_id", "period"]
    }
  },
  {
    name: "detect_anomalies",
    description: "Detect unusual transactions and potential fraud",
    inputSchema: {
      type: "object",
      properties: {
        business_id: { type: "string", description: "Business ID" },
        lookback_days: { type: "number", description: "Number of days to analyze (default 30)" },
        sensitivity: { 
          type: "string", 
          enum: ["low", "medium", "high"],
          description: "Detection sensitivity level" 
        }
      },
      required: ["business_id"]
    }
  },
  {
    name: "generate_insights",
    description: "Generate AI-powered business insights and recommendations",
    inputSchema: {
      type: "object",
      properties: {
        business_id: { type: "string", description: "Business ID" },
        focus_area: { 
          type: "string", 
          enum: ["cash_flow", "expenses", "revenue", "growth", "efficiency", "all"],
          description: "Specific area to focus insights on" 
        },
        language: { type: "string", enum: ["en", "sw"], description: "Response language" }
      },
      required: ["business_id"]
    }
  },
  {
    name: "create_alerts",
    description: "Set up automated alerts for business monitoring",
    inputSchema: {
      type: "object",
      properties: {
        business_id: { type: "string", description: "Business ID" },
        alert_type: { 
          type: "string", 
          enum: ["low_balance", "large_expense", "overdue_invoice", "revenue_drop", "fraud_detection"],
          description: "Type of alert to create" 
        },
        threshold: { type: "number", description: "Alert threshold value" },
        notification_method: { 
          type: "string", 
          enum: ["whatsapp", "sms", "email", "dashboard"],
          description: "How to notify when alert triggers" 
        }
      },
      required: ["business_id", "alert_type", "threshold"]
    }
  },
  {
    name: "expense_analysis",
    description: "Deep dive analysis of business expenses",
    inputSchema: {
      type: "object",
      properties: {
        business_id: { type: "string", description: "Business ID" },
        period: { 
          type: "string", 
          enum: ["month", "quarter", "year"],
          description: "Analysis period" 
        },
        category: { type: "string", description: "Specific expense category to analyze (optional)" },
        comparison: { type: "boolean", description: "Include period-over-period comparison" }
      },
      required: ["business_id", "period"]
    }
  },
  {
    name: "cash_flow_forecast",
    description: "Forecast future cash flow based on historical patterns",
    inputSchema: {
      type: "object",
      properties: {
        business_id: { type: "string", description: "Business ID" },
        forecast_days: { type: "number", description: "Number of days to forecast (default 30)" },
        include_pending_invoices: { type: "boolean", description: "Include pending invoices in forecast" },
        include_recurring: { type: "boolean", description: "Include recurring expenses/income" }
      },
      required: ["business_id"]
    }
  },
  {
    name: "tax_preparation_summary",
    description: "Generate summary for KRA tax preparation",
    inputSchema: {
      type: "object",
      properties: {
        business_id: { type: "string", description: "Business ID" },
        tax_period: { 
          type: "string", 
          enum: ["monthly", "quarterly", "annual"],
          description: "Tax reporting period" 
        },
        year: { type: "number", description: "Tax year" },
        quarter: { type: "number", description: "Quarter (1-4) for quarterly returns" },
        month: { type: "number", description: "Month (1-12) for monthly returns" }
      },
      required: ["business_id", "tax_period", "year"]
    }
  },
  {
    name: "business_health_score",
    description: "Calculate overall business health score with recommendations",
    inputSchema: {
      type: "object",
      properties: {
        business_id: { type: "string", description: "Business ID" },
        include_recommendations: { type: "boolean", description: "Include improvement recommendations" }
      },
      required: ["business_id"]
    }
  }
];

// Tool handlers
async function handleTool(name: string, args: any): Promise<any> {
  try {
    switch (name) {
      case "get_business_dashboard": {
        // Get business profile
        const { data: business, error: businessError } = await supabase
          .from('businesses')
          .select('*')
          .eq('id', args.business_id)
          .single();
        
        if (businessError) throw businessError;
        if (!business) throw new Error(`Business ${args.business_id} not found`);

        // Calculate period dates
        const now = new Date();
        let startDate: Date, endDate: Date = now;

        switch (args.period) {
          case 'today':
            startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            break;
          case 'week':
            startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            break;
          case 'month':
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
            break;
          case 'quarter':
            const quarterStart = Math.floor(now.getMonth() / 3) * 3;
            startDate = new Date(now.getFullYear(), quarterStart, 1);
            break;
          case 'year':
            startDate = new Date(now.getFullYear(), 0, 1);
            break;
          case 'custom':
            if (!args.start_date || !args.end_date) {
              throw new Error('Custom period requires start_date and end_date');
            }
            startDate = new Date(args.start_date);
            endDate = new Date(args.end_date);
            break;
          default:
            throw new Error('Invalid period specified');
        }

        // Get transactions and invoices
        const { data: transactions } = await supabase
          .from('transactions')
          .select('*')
          .eq('business_id', args.business_id)
          .gte('transaction_date', startDate.toISOString())
          .lte('transaction_date', endDate.toISOString())
          .order('transaction_date', { ascending: false });

        const { data: invoices } = await supabase
          .from('invoices')
          .select('*')
          .eq('business_id', args.business_id);

        // Calculate metrics
        const metrics = calculateBusinessMetrics(
          transactions || [], 
          invoices || [], 
          { 
            start: startDate.toISOString().split('T')[0], 
            end: endDate.toISOString().split('T')[0] 
          }
        );

        // Generate insights (now AI-powered!)
        const aiInsights = await generateAIInsights({
          revenue: metrics.total_revenue,
          expenses: metrics.total_expenses,
          profit: metrics.net_profit,
          outstanding_invoices: metrics.outstanding_invoices,
          top_expenses: metrics.top_expense_categories.slice(0, 3),
          payment_methods: metrics.payment_method_breakdown.slice(0, 3)
        }, args.language || 'en');

        // Combine with rule-based insights
        const ruleBasedInsights = generateBusinessInsights(metrics, transactions || [], invoices || []);
        const allInsights = [...aiInsights, ...ruleBasedInsights].slice(0, 5); // Max 5 insights

        // Detect fraud/anomalies
        const fraudAlerts = detectFraudPatterns(transactions || [], business);

        const dashboard = {
          business_info: {
            name: business.name,
            id: business.id,
            currency: business.currency || 'KES'
          },
          period: {
            start: startDate.toISOString().split('T')[0],
            end: endDate.toISOString().split('T')[0],
            period_type: args.period
          },
          financial_summary: {
            total_revenue: metrics.total_revenue,
            total_expenses: metrics.total_expenses,
            net_profit: metrics.net_profit,
            gross_margin: `${metrics.gross_margin.toFixed(1)}%`,
            cash_flow: metrics.cash_flow
          },
          transaction_summary: {
            total_transactions: metrics.transaction_count,
            average_transaction: metrics.avg_transaction_value,
            payment_methods: metrics.payment_method_breakdown
          },
          invoicing_summary: {
            outstanding_invoices: metrics.outstanding_invoices,
            overdue_invoices: metrics.overdue_invoices,
            total_outstanding_amount: invoices?.filter(inv => 
              inv.status === 'sent' || inv.status === 'overdue'
            ).reduce((sum, inv) => sum + inv.amount, 0) || 0
          },
          expense_breakdown: metrics.top_expense_categories,
          alerts: {
            fraud_alerts: fraudAlerts.length,
            cash_flow_alerts: metrics.cash_flow < 0 ? 1 : 0,
            overdue_alerts: metrics.overdue_invoices
          },
          insights: allInsights,
          recommendations: allInsights.filter(i => i.action_required).slice(0, 3)
        };

        return {
          content: [
            {
              type: "text",
              text: args.language === 'sw' ? 
                `Ripoti ya Biashara - ${business.name}:\n${JSON.stringify(dashboard, null, 2)}` :
                `Business Dashboard - ${business.name}:\n${JSON.stringify(dashboard, null, 2)}`
            }
          ]
        };
      }

      case "detect_anomalies": {
        const lookbackDays = args.lookback_days || 30;
        const startDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

        // Get business and transactions
        const { data: business } = await supabase
          .from('businesses')
          .select('*')
          .eq('id', args.business_id)
          .single();

        const { data: transactions } = await supabase
          .from('transactions')
          .select('*')
          .eq('business_id', args.business_id)
          .gte('transaction_date', startDate.toISOString());

        if (!transactions || transactions.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No transactions found in the specified period."
              }
            ]
          };
        }

        // Detect anomalies
        const fraudAlerts = detectFraudPatterns(transactions, business);
        
        // Adjust sensitivity
        let filteredAlerts = fraudAlerts;
        if (args.sensitivity === 'low') {
          filteredAlerts = fraudAlerts.filter(alert => alert.risk_score >= 80);
        } else if (args.sensitivity === 'medium') {
          filteredAlerts = fraudAlerts.filter(alert => alert.risk_score >= 60);
        }
        // High sensitivity shows all alerts

        // Save alerts to database
        if (filteredAlerts.length > 0) {
          await supabase
            .from('fraud_alerts')
            .insert(filteredAlerts);
        }

        return {
          content: [
            {
              type: "text",
              text: `Anomaly Detection Results:\n${JSON.stringify({
                analysis_period: `${lookbackDays} days`,
                transactions_analyzed: transactions.length,
                anomalies_detected: filteredAlerts.length,
                high_risk_alerts: filteredAlerts.filter(a => a.risk_score >= 80).length,
                medium_risk_alerts: filteredAlerts.filter(a => a.risk_score >= 60 && a.risk_score < 80).length,
                low_risk_alerts: filteredAlerts.filter(a => a.risk_score < 60).length,
                alerts: filteredAlerts
              }, null, 2)}`
            }
          ]
        };
      }

      case "generate_insights": {
        // Get business data
        const { data: business } = await supabase
          .from('businesses')
          .select('*')
          .eq('id', args.business_id)
          .single();

        // Get last 30 days of data for context
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const { data: transactions } = await supabase
          .from('transactions')
          .select('*')
          .eq('business_id', args.business_id)
          .gte('transaction_date', thirtyDaysAgo.toISOString());

        const { data: invoices } = await supabase
          .from('invoices')
          .select('*')
          .eq('business_id', args.business_id);

        if (!transactions || transactions.length === 0) {
          return {
            content: [{
              type: "text",
              text: args.language === 'sw' ? 
                "Hakuna data ya kutosha ya miezi 30 iliyopita kutengeneza maarifa." :
                "Insufficient data from last 30 days to generate insights."
            }]
          };
        }

        // Calculate basic metrics for AI context
        const revenue = transactions.filter(t => t.amount > 0).reduce((sum, t) => sum + t.amount, 0);
        const expenses = Math.abs(transactions.filter(t => t.amount < 0).reduce((sum, t) => sum + t.amount, 0));
        const profit = revenue - expenses;

        // Focus area filtering
        let focusData = {
          revenue,
          expenses,
          profit,
          outstanding_invoices: invoices?.filter(inv => inv.status === 'sent' || inv.status === 'overdue').length || 0,
          top_expenses: transactions
            .filter(t => t.amount < 0)
            .slice(0, 5)
            .map(t => ({ description: t.description, amount: Math.abs(t.amount) })),
          payment_methods: transactions.reduce((acc: any, t) => {
            acc[t.payment_method] = (acc[t.payment_method] || 0) + 1;
            return acc;
          }, {})
        };

        // Generate AI insights
        const insights = await generateAIInsights(focusData, args.language || 'en');

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              business_name: business?.name,
              analysis_period: "Last 30 days",
              focus_area: args.focus_area || 'all',
              insights_generated: insights.length,
              insights: insights,
              ai_powered: true,
              data_summary: {
                total_revenue: revenue,
                total_expenses: expenses,
                net_profit: profit,
                transactions_analyzed: transactions.length
              }
            }, null, 2)
          }]
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${error instanceof Error ? error.message : String(error)}`
        }
      ],
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
    
    // Handle MCP protocol requests
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
});
