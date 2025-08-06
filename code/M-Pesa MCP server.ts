// supabase/functions/mpesa-processor/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Types and Interfaces
interface MpesaTransaction {
  id?: string;
  transaction_id: string;
  date: string;
  time: string;
  type: 'received' | 'sent' | 'withdraw' | 'deposit' | 'paybill' | 'buy_goods' | 'airtime' | 'fuliza';
  amount: number;
  transaction_cost: number;
  counterparty: string;
  counterparty_phone?: string;
  account_number?: string;
  reference?: string;
  balance_after: number;
  raw_text: string;
  confidence_score: number;
  network: 'mpesa' | 'airtel' | 'tkash' | 'international';
  category?: string;
  business_id?: string;
  created_at?: string;
}

interface BusinessProfile {
  id: string;
  name: string;
  industry: string;
  average_transaction_size: number;
  peak_hours: string[];
  common_counterparties: string[];
  suspicious_patterns: string[];
}

interface MCPTool {
  name: string;
  description: string;
  parameters: any;
}
1. BUSINESS DATA ISOLATION - Add this to your existing class
class BusinessSecurityManager {
  private supabase: any;

  constructor(supabase: any) {
    this.supabase = supabase;
  }

  // Add this method to validate business access
  async validateBusinessAccess(businessId: string, userId: string): Promise<boolean> {
    if (!businessId || !userId) return false;

    const { data, error } = await this.supabase
      .from('business_profiles')
      .select('id')
      .eq('id', businessId)
      .eq('owner_id', userId) // Assuming owner_id links to auth user
      .single();

    return !error && data;
  }

  // Add this to sanitize business_id in all queries
  async getBusinessProfile(businessId: string, userId: string): Promise<any> {
    if (!await this.validateBusinessAccess(businessId, userId)) {
      throw new Error('Unauthorized access to business data');
    }

    const { data, error } = await this.supabase
      .from('business_profiles')
      .select('*')
      .eq('id', businessId)
      .single();

    if (error) throw new Error(`Business not found: ${error.message}`);
    return data;
  }
}

// 2. PERSISTENT RATE LIMITING - Replace your in-memory rate limiting
class PersistentRateLimit {
  private supabase: any;

  constructor(supabase: any) {
    this.supabase = supabase;
  }

  async checkRateLimit(businessId: string, operation: string, limitPerMinute: number = 60): Promise<boolean> {
    const now = new Date();
    const oneMinuteAgo = new Date(now.getTime() - 60000);

    try {
      // Get current count in the last minute
      const { data: recentRequests, error: countError } = await this.supabase
        .from('api_requests_log')
        .select('id')
        .eq('business_id', businessId)
        .eq('operation', operation)
        .gte('created_at', oneMinuteAgo.toISOString());

      if (countError) {
        console.error('Rate limit check error:', countError);
        return true; // Allow on error to avoid blocking legitimate requests
      }

      const currentCount = recentRequests?.length || 0;

      // Log this request
      await this.supabase
        .from('api_requests_log')
        .insert({
          business_id: businessId,
          operation: operation,
          ip_address: null, // Add if available from request
          created_at: now.toISOString()
        });

      return currentCount < limitPerMinute;
    } catch (error) {
      console.error('Rate limiting error:', error);
      return true; // Allow on error
    }
  }

  // Cleanup old records periodically
  async cleanupOldRecords(): Promise<void> {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    await this.supabase
      .from('api_requests_log')
      .delete()
      .lt('created_at', oneDayAgo.toISOString());
  }
}

// 3. API QUOTA MANAGEMENT - Add this class
class APIQuotaManager {
  private supabase: any;
  private quotas = {
    gemini: { daily: 1000, monthly: 30000 },
    vision: { daily: 500, monthly: 15000 }
  };

  constructor(supabase: any) {
    this.supabase = supabase;
  }

  async checkQuota(service: 'gemini' | 'vision'): Promise<boolean> {
    const today = new Date().toISOString().split('T')[0];
    const thisMonth = new Date().toISOString().substring(0, 7); // YYYY-MM

    try {
      // Check daily usage
      const { data: dailyUsage, error: dailyError } = await this.supabase
        .from('api_usage_log')
        .select('id')
        .eq('service', service)
        .gte('created_at', `${today}T00:00:00.000Z`)
        .lt('created_at', `${today}T23:59:59.999Z`);

      if (dailyError) {
        console.error('Daily quota check error:', dailyError);
        return true;
      }

      const dailyCount = dailyUsage?.length || 0;
      if (dailyCount >= this.quotas[service].daily) {
        console.warn(`Daily quota exceeded for ${service}: ${dailyCount}/${this.quotas[service].daily}`);
        return false;
      }

      // Check monthly usage
      const { data: monthlyUsage, error: monthlyError } = await this.supabase
        .from('api_usage_log')
        .select('id')
        .eq('service', service)
        .gte('created_at', `${thisMonth}-01T00:00:00.000Z`);

      if (monthlyError) {
        console.error('Monthly quota check error:', monthlyError);
        return true;
      }

      const monthlyCount = monthlyUsage?.length || 0;
      if (monthlyCount >= this.quotas[service].monthly) {
        console.warn(`Monthly quota exceeded for ${service}: ${monthlyCount}/${this.quotas[service].monthly}`);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Quota check error:', error);
      return true; // Allow on error
    }
  }

  async logAPIUsage(service: 'gemini' | 'vision', businessId: string, success: boolean, responseTime?: number): Promise<void> {
    try {
      await this.supabase
        .from('api_usage_log')
        .insert({
          service,
          business_id: businessId,
          success,
          response_time_ms: responseTime,
          created_at: new Date().toISOString()
        });
    } catch (error) {
      console.error('Failed to log API usage:', error);
    }
  }
}

// 4. BASIC MONITORING - Add this to your existing class methods
class ProductionLogger {
  private supabase: any;

  constructor(supabase: any) {
    this.supabase = supabase;
  }

  async logOperation(operation: string, businessId: string, duration: number, success: boolean, error?: string): Promise<void> {
    try {
      // Console logging for immediate debugging
      const logLevel = success ? 'INFO' : 'ERROR';
      const timestamp = new Date().toISOString();
      
      console.log(`[${logLevel}] ${timestamp}: ${operation} - Business: ${businessId}, Duration: ${duration}ms, Success: ${success}${error ? `, Error: ${error}` : ''}`);

      // Database logging for persistence and monitoring
      await this.supabase
        .from('operation_logs')
        .insert({
          operation,
          business_id: businessId,
          duration_ms: duration,
          success,
          error_message: error,
          created_at: timestamp
        });
    } catch (logError) {
      console.error('Logging failed:', logError);
    }
  }

  async logMetric(metric_name: string, value: number, businessId?: string): Promise<void> {
    try {
      await this.supabase
        .from('metrics_log')
        .insert({
          metric_name,
          value,
          business_id: businessId,
          created_at: new Date().toISOString()
        });
    } catch (error) {
      console.error('Metric logging failed:', error);
    }
  }
}

// Enhanced M-Pesa MCP Server for Supabase Edge Functions
class MpesaMCPServer {
  private supabase;
  private rateLimitCache = new Map<string, { count: number; resetTime: number }>();

  constructor() {
    this.supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );
  }

  // MCP Server Definition
  get tools(): MCPTool[] {
    return [
      {
        name: "parse_mpesa_statement",
        description: "Parse M-Pesa statement from WhatsApp image/text and extract transactions with 2025 formats",
        parameters: {
          type: "object",
          properties: {
            statement_data: { type: "string", description: "Raw M-Pesa text or base64 image" },
            format: { type: "string", enum: ["whatsapp_image", "sms_text", "pdf", "screenshot"] },
            business_id: { type: "string" },
            language: { type: "string", enum: ["en", "sw"], default: "en" }
          },
          required: ["statement_data", "business_id"]
        }
      },
      {
        name: "categorize_transactions",
        description: "Auto-categorize transactions using Kenyan business context and ML",
        parameters: {
          type: "object",
          properties: {
            transactions: { type: "array" },
            business_id: { type: "string" },
            learning_mode: { type: "boolean", default: true }
          },
          required: ["transactions", "business_id"]
        }
      },
      {
        name: "detect_anomalies",
        description: "Detect fraudulent, duplicate or suspicious transactions",
        parameters: {
          type: "object",
          properties: {
            business_id: { type: "string" },
            transaction_batch: { type: "array", description: "Optional specific transactions to analyze" },
            sensitivity: { type: "string", enum: ["low", "medium", "high"], default: "medium" },
            time_window: { type: "string", default: "7d" }
          },
          required: ["business_id"]
        }
      },
      {
        name: "get_transaction_insights",
        description: "Generate business insights from M-Pesa transaction patterns",
        parameters: {
          type: "object",
          properties: {
            business_id: { type: "string" },
            period: { type: "string", enum: ["day", "week", "month", "quarter"], default: "month" },
            metrics: { type: "array", items: { type: "string" }, default: ["revenue", "expenses", "trends"] }
          },
          required: ["business_id"]
        }
      },
      {
        name: "reconcile_with_books",
        description: "Reconcile M-Pesa transactions with business records",
        parameters: {
          type: "object",
          properties: {
            business_id: { type: "string" },
            start_date: { type: "string" },
            end_date: { type: "string" },
            account_type: { type: "string", enum: ["all", "revenue", "expenses"], default: "all" }
          },
          required: ["business_id", "start_date", "end_date"]
        }
      }
    ];
  }

  // Main call handler
  async call(toolName: string, parameters: any, userId?: string) {
     const startTime = Date.now();
    const businessId = parameters?.business_id;
    
    try {
      // 1. Business data isolation check
      if (businessId && userId) {
        const hasAccess = await this.securityManager.validateBusinessAccess(businessId, userId);
        if (!hasAccess) {
          throw new Error('Unauthorized access to business data');
        }
      }
      
      // 2. Rate limiting check
      const rateLimitOk = await this.rateLimit.checkRateLimit(businessId, toolName, 60);
      if (!rateLimitOk) {
        throw new Error('Rate limit exceeded. Please wait before making another request.');
      }

      // 3. Call your existing implementation
      const result = await super.call(toolName, parameters);

      // 4. Log successful operation
      const duration = Date.now() - startTime;
      await this.logger.logOperation(toolName, businessId, duration, true);
      await this.logger.logMetric('successful_operations', 1, businessId);

      return result;
      // 5. Log failed operation
      const duration = Date.now() - startTime;
      await this.logger.logOperation(toolName, businessId, duration, false, error.message);
      await this.logger.logMetric('failed_operations', 1, businessId);

      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    


      switch (toolName) {
        case "parse_mpesa_statement":
          return await this.parseMpesaStatement(parameters);
        
        case "categorize_transactions":
          return await this.categorizeTransactions(parameters);
        
        case "detect_anomalies":
          return await this.detectAnomalies(parameters);
        
        case "get_transaction_insights":
          return await this.getTransactionInsights(parameters);
        
        case "reconcile_with_books":
          return await this.reconcileWithBooks(parameters);
        
        default:
          throw new Error(`Unknown tool: ${toolName}`);
      }
    } catch (error) {
      console.error(`Error in ${toolName}:`, error);
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  // 1. ENHANCED TRANSACTION PARSING with 2025 M-Pesa formats
  private async parseMpesaStatement(params: any): Promise<any> {
    const { statement_data, format, business_id, language = 'en' } = params;

    let rawText = statement_data;
    
    // Handle different input formats
    if (format === 'whatsapp_image' || format === 'screenshot') {
      rawText = await this.processImage(statement_data);
    }

    // Extract transactions using AI + fallback
    const transactions = await this.extractTransactions(rawText, business_id);
    
    // Store transactions
    if (transactions.length > 0) {
      await this.storeTransactions(transactions, business_id);
    }

    const message = language === 'sw' ? 
      `Nimepata miamala ${transactions.length}. Jumla ya pesa: KES ${this.calculateTotal(transactions)}` :
      `Found ${transactions.length} transactions. Total amount: KES ${this.calculateTotal(transactions)}`;

    return {
      success: true,
      transactions,
      total_count: transactions.length,
      total_amount: this.calculateTotal(transactions),
      business_id,
      message,
      processing_confidence: this.calculateAverageConfidence(transactions),
      timestamp: new Date().toISOString()
    };
  }

  private async extractTransactions(rawText: string, businessId: string): Promise<MpesaTransaction[]> {
    const apiKey = Deno.env.get('GEMINI_API_KEY');
    
    if (!apiKey) {
      console.log('No Gemini API key, using fallback parsing');
      return this.enhancedFallbackExtraction(rawText);
    }

    // Enhanced prompt with 2025 M-Pesa formats
    const prompt = `You are an expert at parsing Kenyan M-Pesa transaction data from 2025. Extract ALL transactions with high accuracy.

M-Pesa Transaction Text:
"""
${rawText}
"""

IMPORTANT: Use these EXACT 2025 M-Pesa message formats as reference:

RECEIVED MONEY:
"QCK1234567 Confirmed. You have received Ksh500.00 from JOHN DOE 254712345678 on 15/1/25 at 2:30 PM. New M-PESA balance is Ksh15,500.00. Transaction cost, Ksh0.00."

SENT MONEY:
"QFL1234567 Confirmed. Ksh200.00 sent to MARY SHOP 254798765432 on 15/1/25 at 3:45 PM for account. New M-PESA balance is Ksh15,300.00. Transaction cost, Ksh5.00."

PAY BILL:
"QBP1234567 Confirmed. Ksh1,000.00 paid to KENYA POWER. Account number 123456789 on 15/1/25 at 4:00 PM. New M-PESA balance is Ksh14,300.00. Transaction cost, Ksh0.00."

BUY GOODS:
"QBG1234567 Confirmed. Ksh300.00 paid to MAMA MBOGA SHOP - 567890 on 15/1/25 at 5:00 PM. New M-PESA balance is Ksh14,000.00. Transaction cost, Ksh0.00."

WITHDRAW:
"QWD1234567 Confirmed. You have withdrawn Ksh1,500.00 from agent JOHN'S SHOP on 15/1/25 at 6:00 PM. New M-PESA balance is Ksh12,500.00. Transaction cost, Ksh33.00."

AIRTIME:
"QAI1234567 Confirmed. You bought Ksh100.00 of airtime for 254712345678 on 15/1/25 at 7:00 PM. New M-PESA balance is Ksh12,400.00."

NEW 2025 FEATURES to recognize:
- Cross-network transfers (to Airtel Money, T-Kash)
- International transfers (to/from other countries)
- Fuliza (overdraft) transactions
- KCB M-PESA, Equity M-PESA integrations

Extract with this EXACT JSON structure:
[
  {
    "transaction_id": "QCK1234567",
    "date": "2025-01-15",
    "time": "14:30",
    "type": "received|sent|withdraw|deposit|paybill|buy_goods|airtime|fuliza",
    "amount": 500.00,
    "transaction_cost": 0.00,
    "counterparty": "JOHN DOE",
    "counterparty_phone": "254712345678",
    "account_number": null,
    "reference": "Payment for goods",
    "balance_after": 15500.00,
    "raw_text": "original transaction text",
    "confidence_score": 0.95,
    "network": "mpesa|airtel|tkash|international"
  }
]

Return ONLY valid JSON array, no explanations.`;

    try {
      const response = await this.callGeminiWithRetry(prompt, 3);
      const data = await response.json();
      const jsonText = data.candidates[0].content.parts[0].text;
      
      const cleanedJson = jsonText.replace(/```json\n?|\n?```/g, '').trim();
      const transactions = JSON.parse(cleanedJson);
      
      return this.validateAndEnhanceTransactions(transactions, businessId);
      
    } catch (error) {
      console.error('AI extraction failed, using enhanced fallback:', error);
      return this.enhancedFallbackExtraction(rawText);
    }
  }

  // 2. ENHANCED FALLBACK with 2025 patterns
  private enhancedFallbackExtraction(rawText: string): MpesaTransaction[] {
    const transactions: MpesaTransaction[] = [];
    
    // Updated regex patterns for 2025 M-Pesa formats
    const patterns = [
      // Received money (enhanced)
      /([A-Z]{3}\d{7})\s+Confirmed.*?received\s+Ksh([\d,]+\.?\d*)\s+from\s+([A-Z\s\-'\.]+?)\s+(\d{9,15})\s+on\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+at\s+([\d:]+\s*[APap][Mm]?).*?balance.*?Ksh([\d,]+\.?\d*).*?cost.*?Ksh([\d,]+\.?\d*)/gi,
      
      // Sent money (enhanced)  
      /([A-Z]{3}\d{7})\s+Confirmed.*?Ksh([\d,]+\.?\d*)\s+sent\s+to\s+([A-Z\s\-'\.]+?)\s+(\d{9,15})\s+on\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+at\s+([\d:]+\s*[APap][Mm]?).*?balance.*?Ksh([\d,]+\.?\d*).*?cost.*?Ksh([\d,]+\.?\d*)/gi,
      
      // Pay Bill
      /([A-Z]{3}\d{7})\s+Confirmed.*?Ksh([\d,]+\.?\d*)\s+paid\s+to\s+([A-Z\s\-'\.]+?)\.?\s+Account\s+number\s+(\w+)\s+on\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+at\s+([\d:]+\s*[APap][Mm]?).*?balance.*?Ksh([\d,]+\.?\d*)/gi,
      
      // Buy Goods
      /([A-Z]{3}\d{7})\s+Confirmed.*?Ksh([\d,]+\.?\d*)\s+paid\s+to\s+([A-Z\s\-'\.]+?)\s+-\s+(\d+)\s+on\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+at\s+([\d:]+\s*[APap][Mm]?).*?balance.*?Ksh([\d,]+\.?\d*)/gi,
      
      // Withdrawal
      /([A-Z]{3}\d{7})\s+Confirmed.*?withdrawn\s+Ksh([\d,]+\.?\d*)\s+from\s+agent\s+([A-Z\s\-'\.]+?)\s+on\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+at\s+([\d:]+\s*[APap][Mm]?).*?balance.*?Ksh([\d,]+\.?\d*).*?cost.*?Ksh([\d,]+\.?\d*)/gi,
      
      // Airtime
      /([A-Z]{3}\d{7})\s+Confirmed.*?bought\s+Ksh([\d,]+\.?\d*)\s+of\s+airtime\s+for\s+(\d{9,15})\s+on\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+at\s+([\d:]+\s*[APap][Mm]?).*?balance.*?Ksh([\d,]+\.?\d*)/gi
    ];

    patterns.forEach((pattern, patternIndex) => {
      let match;
      while ((match = pattern.exec(rawText)) !== null) {
        try {
          const transaction = this.parsePatternMatch(match, patternIndex);
          if (transaction) {
            transactions.push(transaction);
          }
        } catch (error) {
          console.error('Error parsing transaction match:', error);
        }
      }
    });

    return this.deduplicateTransactions(transactions);
  }

  // 3. ENHANCED CATEGORIZATION
  private async categorizeTransactions(params: any): Promise<any> {
    const { transactions, business_id, learning_mode = true } = params;
    
    const businessProfile = await this.getBusinessProfile(business_id);
    const categories = this.getEnhanced2025BusinessCategories();
    
    const categorized = [];
    
    for (const transaction of transactions) {
      const category = await this.predictCategory(transaction, businessProfile, categories);
      const enhancedTransaction = {
        ...transaction,
        category: category.name,
        category_confidence: category.confidence,
        suggested_vat_rate: category.vat_applicable ? 0.16 : 0,
        business_impact: category.business_impact
      };
      categorized.push(enhancedTransaction);
    }

    // Store categorized transactions
    if (learning_mode) {
      await this.storeCategorizedTransactions(categorized, business_id);
      await this.updateLearningPatterns(business_id, categorized);
    }

    return {
      success: true,
      categorized_transactions: categorized,
      categories_found: [...new Set(categorized.map(t => t.category))],
      high_confidence_count: categorized.filter(t => t.category_confidence > 0.8).length,
      vat_applicable_count: categorized.filter(t => t.suggested_vat_rate > 0).length,
      learning_updated: learning_mode,
      business_id,
      timestamp: new Date().toISOString()
    };
  }

  // 4. ENHANCED ANOMALY DETECTION
  private async detectAnomalies(params: any): Promise<any> {
    const { business_id, transaction_batch, sensitivity = 'medium', time_window = '7d' } = params;
    
    const transactions = transaction_batch || await this.getRecentTransactions(business_id, time_window);
    const businessProfile = await this.getBusinessProfile(business_id);
    
    const anomalies = [];
    const enhancedChecks = {
      // Basic checks
      unusual_amount: this.checkUnusualAmounts(transactions, businessProfile, sensitivity),
      unusual_time: this.checkUnusualTiming(transactions, businessProfile),
      duplicate_transactions: this.checkDuplicates(transactions),
      
      // 2025-specific checks
      mpesa_fraud_patterns: this.checkMpesaFraudPatterns(transactions),
      rapid_consecutive: this.checkRapidConsecutiveTransactions(transactions, 300),
      round_number_fraud: this.checkRoundNumberFraud(transactions),
      cross_network_anomalies: this.checkCrossNetworkAnomalies(transactions),
      fuliza_overuse: this.checkFulizaPatterns(transactions)
    };

    for (const transaction of transactions) {
      const detectedAnomalies = [];
      
      Object.entries(enhancedChecks).forEach(([checkType, checkFunction]) => {
        if (typeof checkFunction === 'function' && checkFunction(transaction)) {
          detectedAnomalies.push(checkType);
        }
      });

      if (detectedAnomalies.length > 0) {
        anomalies.push({
          transaction,
          anomaly_types: detectedAnomalies,
          risk_score: this.calculateEnhancedRiskScore(detectedAnomalies, transaction),
          recommendation: this.getEnhanced2025Recommendation(detectedAnomalies),
          requires_immediate_attention: this.requiresImmediateAttention(detectedAnomalies)
        });
      }
    }

    return {
      success: true,
      anomalies_detected: anomalies.length,
      high_risk_count: anomalies.filter(a => a.risk_score > 0.8).length,
      immediate_attention_count: anomalies.filter(a => a.requires_immediate_attention).length,
      anomalies: anomalies.sort((a, b) => b.risk_score - a.risk_score),
      risk_level: this.assessOverallRisk(anomalies),
      business_id,
      analysis_timestamp: new Date().toISOString()
    };
  }

  // 5. TRANSACTION INSIGHTS
 private async getTransactionInsights(params: any): Promise<any> {
  const { business_id, period = 'month', metrics = ['revenue', 'expenses', 'trends'] } = params;
    
  // Calculate date range
  const endDate = new Date().toISOString().split('T')[0];
  const startDate = this.getStartDateForPeriod(period);
  
  const insights: any = {
    success: true,
    business_id,
    period,
    date_range: { startDate, endDate }
  };

  if (metrics.includes('revenue')) {
    insights.revenue = await this.calculateRevenueInsights(business_id, startDate, endDate);
  }

  if (metrics.includes('expenses')) {
    insights.expenses = await this.calculateExpenseInsights(business_id, startDate, endDate);
  }

  if (metrics.includes('trends')) {
    const transactions = await this.getTransactionsByPeriod(business_id, period);
    insights.trends = this.calculateTrendInsights(transactions);
  }

  return insights;
}

 // Helper Methods
private getStartDateForPeriod(period: string): string {
  const now = new Date();
  let startDate: Date;
  
  switch (period) {
    case 'day':
      startDate = new Date(now.getTime() - (24 * 60 * 60 * 1000));
      break;
    case 'week':
      startDate = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
      break;
    case 'month':
      startDate = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
      break;
    case 'quarter':
      startDate = new Date(now.getTime() - (90 * 24 * 60 * 60 * 1000));
      break;
    default:
      startDate = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
  }
  
  return startDate.toISOString().split('T')[0];
}

 
  protected async processImage(base64Data: string): Promise<string> {
    const quotaOk = await this.quotaManager.checkQuota('vision');
    if (!quotaOk) {
      throw new Error('Vision API quota exceeded. Please try again later.');
    }

    const startTime = Date.now();
    
    try {
      const result = await super.processImage(base64Data);
      const responseTime = Date.now() - startTime;
      await this.quotaManager.logAPIUsage('vision', 'system', true, responseTime);
      return result;
    } catch (error) {
      const responseTime = Date.now() - startTime;
      await this.quotaManager.logAPIUsage('vision', 'system', false, responseTime);
      throw error;
    }
  }
}

   protected async callGeminiWithRetry(prompt: string, maxRetries: number): Promise<Response> {
    // Check quota before making API call
    const quotaOk = await this.quotaManager.checkQuota('gemini');
    if (!quotaOk) {
      throw new Error('Gemini API quota exceeded. Please try again later.');
    }

    const startTime = Date.now();
    let response: Response;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: {
                temperature: 0.1,
                maxOutputTokens: 4000,
                topP: 0.8,
                topK: 40
              }
            })
          }
        );

        if (response.ok) {
          return response;
        }

        if (response.status === 429) {
          const delay = Math.pow(2, attempt) * 1000;
          console.log(`Rate limited, retrying in ${delay}ms (attempt ${attempt})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        throw new Error(`API call failed: ${response.statusText}`);
      } catch (error) {
        if (attempt === maxRetries) {
          throw error;
        }
        console.error(`Attempt ${attempt} failed:`, error);
      }
    }
    
    throw new Error('Max retries exceeded');
  }

  private checkRateLimit(toolName: string): boolean {
    const key = `${toolName}_rate_limit`;
    const now = Date.now();
    const limit = toolName === 'parse_mpesa_statement' ? 10 : 50; // requests per minute
    
    const current = this.rateLimitCache.get(key);
    
    if (!current || now > current.resetTime) {
      this.rateLimitCache.set(key, { count: 1, resetTime: now + 60000 });
      return true;
    }
    
    if (current.count >= limit) {
      return false;
    }
    
    current.count++;
    return true;
  }

  private validateAndEnhanceTransactions(transactions: any[], businessId: string): MpesaTransaction[] {
    return transactions
      .filter(t => this.isValidTransaction(t))
      .map(t => ({
        ...t,
        id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        date: this.standardizeDate(t.date),
        amount: this.parseAmount(t.amount),
        balance_after: this.parseAmount(t.balance_after),
        transaction_cost: this.parseAmount(t.transaction_cost || 0),
        counterparty: this.cleanCounterpartyName(t.counterparty),
        counterparty_phone: this.standardizePhoneNumber(t.counterparty_phone),
        confidence_score: Math.min(Math.max(t.confidence_score || 0.8, 0), 1),
        network: t.network || 'mpesa',
        business_id: businessId,
        created_at: new Date().toISOString()
      }));
  }

  private getEnhanced2025BusinessCategories() {
    return {
      income: {
        sales: ["customer", "client", "payment", "order", "invoice", "bill", "purchase"],
        service_income: ["consultation", "service", "repair", "maintenance", "professional"],
        digital_sales: ["mpesa", "online", "app", "digital", "e-commerce"],
        rental_income: ["rent", "lease", "property", "space"]
      },
      inventory: ["wholesaler", "supplier", "stock", "goods", "inventory", "raw materials", "crates", "bags"],
      utilities: {
        electricity: ["kplc", "kenya power", "electricity", "power", "prepaid"],
        water: ["nairobi water", "water", "sewerage", "county water"],
        internet: ["safaricom", "airtel", "telkom", "zuku", "internet", "wifi", "data"],
        gas: ["gas", "cooking gas", "lpg", "meko"]
      },
      transport: ["matatu", "fuel", "petrol", "diesel", "uber", "bolt", "little", "transport"],
      rent_property: ["landlord", "rent", "deposit", "caretaker", "property"],
      staff_costs: ["salary", "wage", "employee", "staff", "payroll", "nhif", "nssf"],
      tax_compliance: ["kra", "tax", "pin", "vat", "paye", "withholding"],
      marketing: ["advertise", "promotion", "flyer", "billboard", "radio", "facebook"],
      banking_finance: ["loan", "interest", "bank charges", "processing", "mpesa charges"]
    };
  }

  // Utility methods
  private parseAmount(amount: any): number {
    if (typeof amount === 'number') return amount;
    const cleanAmount = String(amount).replace(/[,\s]/g, '');
    return parseFloat(cleanAmount) || 0;
  }

  private calculateTotal(transactions: MpesaTransaction[]): number {
    return transactions.reduce((sum, t) => sum + (t.type === 'received' ? t.amount : -t.amount), 0);
  }

  private calculateAverageConfidence(transactions: MpesaTransaction[]): number {
    if (transactions.length === 0) return 0;
    return transactions.reduce((sum, t) => sum + t.confidence_score, 0) / transactions.length;
  }

  // Placeholder methods for database operations
  private async storeTransactions(transactions: MpesaTransaction[], businessId: string) {
    const { error } = await this.supabase
      .from('transactions')
      .insert(transactions);
    
    if (error) {
      console.error('Error storing transactions:', error);
      throw new Error('Failed to store transactions');
    }
  }

  private async getBusinessProfile(businessId: string): Promise<BusinessProfile> {
    const { data, error } = await this.supabase
      .from('business_profiles')
      .select('*')
      .eq('id', businessId)
      .single();

    if (error) {
      return {
        id: businessId,
        name: 'Unknown Business',
        industry: 'general',
        average_transaction_size: 1000,
        peak_hours: ['09:00-17:00'],
        common_counterparties: [],
        suspicious_patterns: []
      };
    }

    return data;
  }

private async getRecentTransactions(businessId: string, timeWindow: string = '7d'): Promise<MpesaTransaction[]> {
  const days = timeWindow === '7d' ? 7 : 1;
  const since = new Date(Date.now() - (days * 24 * 60 * 60 * 1000)).toISOString().split('T')[0];

  const { data, error } = await this.supabase
    .from('transactions')
    .select('*')
    .eq('business_id', businessId)      // First in composite index
    .gte('date', since)                 // Second in composite index  
    .order('date', { ascending: false }) // Uses index sort order
    .limit(100);                        // Prevent runaway queries

  if (error) {
    console.error('Error fetching recent transactions:', error);
    return [];
  }

  return data || [];
}
  // Additional helper methods implementation
  private isValidTransaction(t: any): boolean {
    return !!(
      t.transaction_id &&
      t.amount &&
      t.date &&
      t.type &&
      ['received', 'sent', 'withdraw', 'deposit', 'paybill', 'buy_goods', 'airtime', 'fuliza'].includes(t.type)
    );
  }

  private standardizeDate(date: string): string {
    // Convert various date formats to ISO string
    try {
      // Handle formats like "15/1/25", "2025-01-15", etc.
      if (date.includes('/')) {
        const parts = date.split('/');
        if (parts.length === 3) {
          const day = parts[0].padStart(2, '0');
          const month = parts[1].padStart(2, '0');
          let year = parts[2];
          
          // Handle 2-digit years
          if (year.length === 2) {
            year = parseInt(year) > 50 ? `19${year}` : `20${year}`;
          }
          
          return `${year}-${month}-${day}`;
        }
      }
      
      // Try parsing as-is
      const parsed = new Date(date);
      return parsed.toISOString().split('T')[0];
    } catch (error) {
      // Fallback to current date
      return new Date().toISOString().split('T')[0];
    }
  }

  private cleanCounterpartyName(name: string): string {
    if (!name) return '';
    return name.trim()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s\-'\.]/g, '')
      .toUpperCase();
  }

  private standardizePhoneNumber(phone: string): string {
    if (!phone) return '';
    
    // Remove non-digits
    const digits = phone.replace(/\D/g, '');
    
    // Standardize to +254 format
    if (digits.startsWith('254')) {
      return `+${digits}`;
    } else if (digits.startsWith('0') && digits.length === 10) {
      return `+254${digits.substring(1)}`;
    } else if (digits.length === 9) {
      return `+254${digits}`;
    }
    
    return phone; // Return original if can't standardize
  }

  private parsePatternMatch(match: any[], patternIndex: number): MpesaTransaction | null {
    try {
      const typeMap = ['received', 'sent', 'paybill', 'buy_goods', 'withdraw', 'airtime'];
      
      return {
        transaction_id: match[1],
        amount: this.parseAmount(match[2]),
        counterparty: this.cleanCounterpartyName(match[3]),
        counterparty_phone: match[4] || '',
        date: this.standardizeDate(match[5]),
        time: match[6] || '',
        balance_after: this.parseAmount(match[7]),
        transaction_cost: this.parseAmount(match[8]) || 0,
        type: typeMap[patternIndex] as any || 'other',
        raw_text: match[0],
        confidence_score: 0.75,
        network: 'mpesa'
      } as MpesaTransaction;
    } catch (error) {
      console.error('Error parsing pattern match:', error);
      return null;
    }
  }

  private deduplicateTransactions(transactions: MpesaTransaction[]): MpesaTransaction[] {
    const seen = new Set();
    return transactions.filter(transaction => {
      const key = `${transaction.transaction_id}_${transaction.amount}_${transaction.date}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  private async predictCategory(transaction: any, profile: BusinessProfile, categories: any): Promise<any> {
    const description = (transaction.reference || transaction.counterparty || '').toLowerCase();
    const amount = transaction.amount;
    const type = transaction.type;
    
    // Income categorization
    if (type === 'received') {
      for (const [category, keywords] of Object.entries(categories.income)) {
        if (Array.isArray(keywords)) {
          for (const keyword of keywords) {
            if (description.includes(keyword)) {
              return { 
                name: `income_${category}`, 
                confidence: 0.85, 
                vat_applicable: true,
                business_impact: 'positive'
              };
            }
          }
        }
      }
      return { 
        name: 'income_other', 
        confidence: 0.6, 
        vat_applicable: true,
        business_impact: 'positive'
      };
    }
    
    // Expense categorization
    if (type === 'sent' || type === 'paybill' || type === 'buy_goods') {
      for (const [category, keywords] of Object.entries(categories)) {
        if (category === 'income') continue;
        
        if (Array.isArray(keywords)) {
          for (const keyword of keywords) {
            if (description.includes(keyword)) {
              return { 
                name: `expense_${category}`, 
                confidence: 0.80, 
                vat_applicable: category !== 'salaries',
                business_impact: 'negative'
              };
            }
          }
        } else if (typeof keywords === 'object') {
          for (const [subcat, subkeywords] of Object.entries(keywords)) {
            for (const keyword of subkeywords as string[]) {
              if (description.includes(keyword)) {
                return { 
                  name: `expense_${category}_${subcat}`, 
                  confidence: 0.85, 
                  vat_applicable: true,
                  business_impact: 'negative'
                };
              }
            }
          }
        }
      }
    }
    
    return { 
      name: 'uncategorized', 
      confidence: 0.3, 
      vat_applicable: false,
      business_impact: 'neutral'
    };
  }

  private async storeCategorizedTransactions(transactions: any[], businessId: string): Promise<void> {
    const { error } = await this.supabase
      .from('categorized_transactions')
      .upsert(transactions.map(t => ({
        ...t,
        business_id: businessId,
        updated_at: new Date().toISOString()
      })));
    
    if (error) {
      console.error('Error storing categorized transactions:', error);
    }
  }

  private async updateLearningPatterns(businessId: string, transactions: any[]): Promise<void> {
    // Extract patterns for machine learning
    const patterns = transactions.map(t => ({
      business_id: businessId,
      counterparty_pattern: t.counterparty,
      amount_range: this.getAmountRange(t.amount),
      category: t.category,
      confidence: t.category_confidence,
      created_at: new Date().toISOString()
    }));

    const { error } = await this.supabase
      .from('learning_patterns')
      .upsert(patterns);
    
    if (error) {
      console.error('Error updating learning patterns:', error);
    }
  }

  private getAmountRange(amount: number): string {
    if (amount < 100) return 'micro';
    if (amount < 1000) return 'small';
    if (amount < 10000) return 'medium';
    if (amount < 100000) return 'large';
    return 'very_large';
  }

  // Anomaly Detection Functions
  private checkUnusualAmounts(transactions: any[], profile: BusinessProfile, sensitivity: string): Function {
    const avgAmount = profile.average_transaction_size;
    const multiplier = sensitivity === 'high' ? 3 : sensitivity === 'medium' ? 5 : 10;
    
    return (transaction: any) => {
      return transaction.amount > (avgAmount * multiplier);
    };
  }

  private checkUnusualTiming(transactions: any[], profile: BusinessProfile): Function {
    const peakHours = profile.peak_hours || ['09:00-17:00'];
    
    return (transaction: any) => {
      if (!transaction.time) return false;
      
      const transactionHour = parseInt(transaction.time.split(':')[0]);
      
      return !peakHours.some(range => {
        const [start, end] = range.split('-').map(t => parseInt(t.split(':')[0]));
        return transactionHour >= start && transactionHour <= end;
      });
    };
  }

  private checkDuplicates(transactions: any[]): Function {
    const transactionMap = new Map();
    
    transactions.forEach(t => {
      const key = `${t.amount}_${t.counterparty}_${t.date}`;
      if (!transactionMap.has(key)) {
        transactionMap.set(key, []);
      }
      transactionMap.get(key).push(t);
    });
    
    return (transaction: any) => {
      const key = `${transaction.amount}_${transaction.counterparty}_${transaction.date}`;
      return transactionMap.get(key)?.length > 1;
    };
  }

  private checkMpesaFraudPatterns(transactions: any[]): Function {
    const suspiciousNames = ['test', 'unknown', 'fraud', 'scam', 'fake'];
    
    return (transaction: any) => {
      const name = (transaction.counterparty || '').toLowerCase();
      
      return suspiciousNames.some(pattern => name.includes(pattern)) ||
             transaction.amount === 1 || // Penny testing
             (transaction.type === 'sent' && transaction.amount > 50000 && transaction.confidence_score < 0.7);
    };
  }

  private checkRapidConsecutiveTransactions(transactions: any[], thresholdSeconds: number): Function {
    const sortedTransactions = transactions.sort((a, b) => 
      new Date(`${a.date} ${a.time}`).getTime() - new Date(`${b.date} ${b.time}`).getTime()
    );
    
    return (transaction: any) => {
      const currentTime = new Date(`${transaction.date} ${transaction.time}`).getTime();
      
      return sortedTransactions.some(t => {
        if (t.transaction_id === transaction.transaction_id) return false;
        
        const otherTime = new Date(`${t.date} ${t.time}`).getTime();
        const timeDiff = Math.abs(currentTime - otherTime);
        
        return timeDiff < (thresholdSeconds * 1000);
      });
    };
  }

  private checkRoundNumberFraud(transactions: any[]): Function {
    return (transaction: any) => {
      const amount = transaction.amount;
      return amount > 1000 && 
             amount % 1000 === 0 && 
             transaction.type === 'sent' &&
             !['rent', 'salary', 'loan'].some(keyword => 
               (transaction.reference || '').toLowerCase().includes(keyword)
             );
    };
  }

  private checkCrossNetworkAnomalies(transactions: any[]): Function {
    return (transaction: any) => {
      return transaction.network !== 'mpesa' && transaction.amount > 10000;
    };
  }

  private checkFulizaPatterns(transactions: any[]): Function {
    const fulizaTransactions = transactions.filter(t => t.type === 'fuliza');
    
    return (transaction: any) => {
      if (transaction.type !== 'fuliza') return false;
      
      // Check if there are too many Fuliza transactions (>3 per week)
      return fulizaTransactions.length > 3;
    };
  }

  private calculateEnhancedRiskScore(anomalyTypes: string[], transaction: any): number {
    const riskWeights = {
      'mpesa_fraud_patterns': 0.9,
      'unusual_amount': 0.7,
      'rapid_consecutive': 0.8,
      'round_number_fraud': 0.6,
      'cross_network_anomalies': 0.5,
      'fuliza_overuse': 0.4,
      'unusual_time': 0.3,
      'duplicate_transactions': 0.8
    };
    
    let totalRisk = 0;
    let maxWeight = 0;
    
    anomalyTypes.forEach(type => {
      const weight = riskWeights[type] || 0.2;
      totalRisk += weight;
      maxWeight = Math.max(maxWeight, weight);
    });
    
    // Normalize to 0-1 scale
    return Math.min(totalRisk / anomalyTypes.length, 1);
  }

  private getEnhanced2025Recommendation(anomalyTypes: string[]): string {
    if (anomalyTypes.includes('mpesa_fraud_patterns')) {
      return 'URGENT: Potential fraud detected. Contact M-Pesa customer care immediately.';
    }
    
    if (anomalyTypes.includes('unusual_amount')) {
      return 'Large transaction detected. Please verify this was authorized.';
    }
    
    if (anomalyTypes.includes('rapid_consecutive')) {
      return 'Multiple transactions in quick succession. Check for unauthorized access to your M-Pesa.';
    }
    
    if (anomalyTypes.includes('duplicate_transactions')) {
      return 'Possible duplicate payment. Check with recipient before sending again.';
    }
    
    return 'Transaction flagged for review. Please verify the details are correct.';
  }

  private requiresImmediateAttention(anomalyTypes: string[]): boolean {
    const criticalAnomalies = [
      'mpesa_fraud_patterns',
      'unusual_amount',
      'rapid_consecutive',
      'duplicate_transactions'
    ];
    
    return anomalyTypes.some(type => criticalAnomalies.includes(type));
  }

  private assessOverallRisk(anomalies: any[]): string {
    if (anomalies.length === 0) return 'low';
    
    const highRiskCount = anomalies.filter(a => a.risk_score > 0.7).length;
    const totalCount = anomalies.length;
    
    if (highRiskCount / totalCount > 0.5) return 'high';
    if (highRiskCount > 0) return 'medium';
    return 'low';
  }

  // Business Intelligence Methods
 private async calculateRevenueInsights(businessId: string, startDate: string, endDate: string): Promise<any> {
  // Use optimized query instead of filtering in memory
  const revenueTransactions = await this.getBusinessIncome(businessId, startDate, endDate);
  const totalRevenue = revenueTransactions.reduce((sum, t) => sum + t.amount, 0);
  
  return {
    total_revenue: totalRevenue,
    transaction_count: revenueTransactions.length,
    average_transaction: revenueTransactions.length > 0 ? totalRevenue / revenueTransactions.length : 0,
    peak_day: this.findPeakDay(revenueTransactions),
    growth_trend: this.calculateGrowthTrend(revenueTransactions)
  };
}

  private calculateExpenseInsights(transactions: MpesaTransaction[]): any {
    const expenseTransactions = transactions.filter(t => 
      ['sent', 'paybill', 'buy_goods', 'withdraw'].includes(t.type)
    );
    const totalExpenses = expenseTransactions.reduce((sum, t) => sum + t.amount, 0);
    
    return {
      total_expenses: totalExpenses,
      transaction_count: expenseTransactions.length,
      average_expense: expenseTransactions.length > 0 ? totalExpenses / expenseTransactions.length : 0,
      largest_expense: Math.max(...expenseTransactions.map(t => t.amount), 0),
      expense_categories: this.groupExpensesByCategory(expenseTransactions)
    };
  }

  private calculateTrendInsights(transactions: MpesaTransaction[]): any {
    const dailyTotals = this.groupTransactionsByDay(transactions);
    
    return {
      daily_averages: dailyTotals,
      busiest_day: this.findBusiestDay(transactions),
      transaction_velocity: this.calculateVelocity(transactions),
      seasonal_patterns: this.detectSeasonalPatterns(transactions)
    };
  }

  private findPeakDay(transactions: MpesaTransaction[]): string {
    const dailyTotals = new Map<string, number>();
    
    transactions.forEach(t => {
      const day = t.date;
      dailyTotals.set(day, (dailyTotals.get(day) || 0) + t.amount);
    });
    
    let peakDay = '';
    let peakAmount = 0;
    
    dailyTotals.forEach((amount, day) => {
      if (amount > peakAmount) {
        peakAmount = amount;
        peakDay = day;
      }
    });
    
    return peakDay;
  }

  private calculateGrowthTrend(transactions: MpesaTransaction[]): string {
    if (transactions.length < 2) return 'insufficient_data';
    
    const sorted = transactions.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const firstHalf = sorted.slice(0, Math.floor(sorted.length / 2));
    const secondHalf = sorted.slice(Math.floor(sorted.length / 2));
    
    const firstHalfTotal = firstHalf.reduce((sum, t) => sum + t.amount, 0);
    const secondHalfTotal = secondHalf.reduce((sum, t) => sum + t.amount, 0);
    
    if (secondHalfTotal > firstHalfTotal * 1.1) return 'growing';
    if (secondHalfTotal < firstHalfTotal * 0.9) return 'declining';
    return 'stable';
  }

  private groupExpensesByCategory(transactions: MpesaTransaction[]): Record<string, number> {
    const categories: Record<string, number> = {};
    
    transactions.forEach(t => {
      const category = (t as any).category || 'uncategorized';
      categories[category] = (categories[category] || 0) + t.amount;
    });
    
    return categories;
  }

  private groupTransactionsByDay(transactions: MpesaTransaction[]): Record<string, number> {
    const dailyTotals: Record<string, number> = {};
    
    transactions.forEach(t => {
      const day = t.date;
      dailyTotals[day] = (dailyTotals[day] || 0) + 1;
    });
    
    return dailyTotals;
  }

  private findBusiestDay(transactions: MpesaTransaction[]): string {
    const dailyCounts = this.groupTransactionsByDay(transactions);
    
    let busiestDay = '';
    let maxCount = 0;
    
    Object.entries(dailyCounts).forEach(([day, count]) => {
      if (count > maxCount) {
        maxCount = count;
        busiestDay = day;
      }
    });
    
    return busiestDay;
  }

  private calculateVelocity(transactions: MpesaTransaction[]): number {
    if (transactions.length < 2) return 0;
    
    const sorted = transactions.sort((a, b) => 
      new Date(`${a.date} ${a.time}`).getTime() - new Date(`${b.date} ${b.time}`).getTime()
    );
    
    const timeSpan = new Date(`${sorted[sorted.length - 1].date} ${sorted[sorted.length - 1].time}`).getTime() - 
                     new Date(`${sorted[0].date} ${sorted[0].time}`).getTime();
    
    const hours = timeSpan / (1000 * 60 * 60);
    return hours > 0 ? transactions.length / hours : 0;
  }

  private detectSeasonalPatterns(transactions: MpesaTransaction[]): string[] {
    // Simple seasonal pattern detection
    const patterns: string[] = [];
    
    const monthlyTotals = new Map<number, number>();
    transactions.forEach(t => {
      const month = new Date(t.date).getMonth();
      monthlyTotals.set(month, (monthlyTotals.get(month) || 0) + t.amount);
    });
    
    // Find peak months
    const sortedMonths = Array.from(monthlyTotals.entries())
      .sort(([,a], [,b]) => b - a);
    
    if (sortedMonths.length > 0) {
      const peakMonth = sortedMonths[0][0];
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
                         'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      patterns.push(`peak_in_${monthNames[peakMonth]}`);
    }
    
    return patterns;
  }

  // Reconciliation method
  private async reconcileWithBooks(params: any): Promise<any> {
    const { business_id, start_date, end_date, account_type = 'all' } = params;
    
    // Get M-Pesa transactions
    const { data: mpesaTransactions, error: mpesaError } = await this.supabase
      .from('transactions')
      .select('*')
      .eq('business_id', business_id)
      .gte('date', start_date)
      .lte('date', end_date);

    if (mpesaError) {
      throw new Error(`Failed to fetch M-Pesa transactions: ${mpesaError.message}`);
    }

    // Get book records
    const { data: bookRecords, error: bookError } = await this.supabase
      .from('book_entries')
      .select('*')
      .eq('business_id', business_id)
      .gte('date', start_date)
      .lte('date', end_date);

    if (bookError) {
      throw new Error(`Failed to fetch book records: ${bookError.message}`);
    }

    // Perform reconciliation
    const reconciliation = this.performReconciliation(mpesaTransactions || [], bookRecords || []);
    
    return {
      success: true,
      reconciliation_summary: reconciliation,
      period: { start_date, end_date },
      business_id,
      timestamp: new Date().toISOString()
    };
  }

  private performReconciliation(mpesaTransactions: any[], bookRecords: any[]): any {
    const matched = [];
    const unmatchedMpesa = [];
    const unmatchedBooks = [];
    
    const bookMap = new Map();
    bookRecords.forEach(record => {
      const key = `${record.amount}_${record.date}`;
      if (!bookMap.has(key)) {
        bookMap.set(key, []);
      }
      bookMap.get(key).push(record);
    });

    mpesaTransactions.forEach(transaction => {
      const key = `${transaction.amount}_${transaction.date}`;
      const matchingBooks = bookMap.get(key);
      
      if (matchingBooks && matchingBooks.length > 0) {
        matched.push({
          mpesa_transaction: transaction,
          book_record: matchingBooks[0]
        });
        matchingBooks.shift(); // Remove matched record
      } else {
        unmatchedMpesa.push(transaction);
      }
    });

    // Collect remaining unmatched book records
    bookMap.forEach(records => {
      unmatchedBooks.push(...records);
    });

    return {
      matched_count: matched.length,
      unmatched_mpesa_count: unmatchedMpesa.length,
      unmatched_books_count: unmatchedBooks.length,
      reconciliation_rate: matched.length / (mpesaTransactions.length + bookRecords.length),
      matched_transactions: matched,
      unmatched_mpesa: unmatchedMpesa,
      unmatched_books: unmatchedBooks
    };
  }

  private async getTransactionsByPeriod(businessId: string, period: string): Promise<MpesaTransaction[]> {
  let startDate: Date;
  const endDate = new Date();
  
  switch (period) {
    case 'day':
      startDate = new Date(endDate.getTime() - (24 * 60 * 60 * 1000));
      break;
    case 'week':
      startDate = new Date(endDate.getTime() - (7 * 24 * 60 * 60 * 1000));
      break;
    case 'month':
      startDate = new Date(endDate.getTime() - (30 * 24 * 60 * 60 * 1000));
      break;
    case 'quarter':
      startDate = new Date(endDate.getTime() - (90 * 24 * 60 * 60 * 1000));
      break;
    default:
      startDate = new Date(endDate.getTime() - (30 * 24 * 60 * 60 * 1000));
  }

  const { data, error } = await this.supabase
    .from('transactions')
    .select('*')
    .eq('business_id', businessId)      // First in composite index
    .gte('date', startDate.toISOString().split('T')[0])
    .lte('date', endDate.toISOString().split('T')[0])
    .order('date', { ascending: false }) // Uses index sort order
    .limit(1000);                       // Prevent massive queries

  if (error) {
    console.error('Error fetching transactions by period:', error);
    return [];
  }

  return data || [];
}
  
private async getBusinessIncome(businessId: string, startDate: string, endDate: string) {
  const { data, error } = await this.supabase
    .from('transactions')
    .select('amount, date, counterparty')
    .eq('business_id', businessId)      // First in index
    .eq('type', 'received')             // Second in index
    .gte('date', startDate)             // Third in index
    .lte('date', endDate)
    .order('date', { ascending: false });

  if (error) {
    console.error('Error fetching business income:', error);
    return [];
  }

  return data || [];
}

private async findDuplicateTransactions(businessId: string, hours: number = 24) {
  const since = new Date(Date.now() - (hours * 60 * 60 * 1000)).toISOString().split('T')[0];
  
  const { data, error } = await this.supabase
    .from('transactions')
    .select('*')
    .eq('business_id', businessId)
    .gte('date', since)
    .order('amount', { ascending: false })  // Uses index
    .order('date', { ascending: false })
    .limit(500);                            // Reasonable limit

  if (error) {
    console.error('Error finding duplicates:', error);
    return [];
  }

  // Group by amount + counterparty in application code
  return this.findDuplicatesInResults(data || []);
}

private findDuplicatesInResults(transactions: any[]) {
  const duplicates = [];
  const seen = new Map();

  for (const transaction of transactions) {
    const key = `${transaction.amount}_${transaction.counterparty}_${transaction.date}`;
    
    if (seen.has(key)) {
      duplicates.push({
        original: seen.get(key),
        duplicate: transaction,
        amount: transaction.amount,
        confidence: 0.9
      });
    } else {
      seen.set(key, transaction);
    }
  }

  return duplicates;
}

// Optimized search using text search index
private async searchTransactions(businessId: string, searchTerm: string, limit: number = 50) {
  const { data, error } = await this.supabase
    .from('transactions')
    .select('*')
    .eq('business_id', businessId)
    .textSearch('search_text', searchTerm)  // Uses GIN index
    .order('date', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Error searching transactions:', error);
    return [];
  }

  return data || [];
}
}

// Main Supabase Edge Function Handler
Deno.serve(async (req: Request) => {
  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { tool, parameters } = await req.json();
    
    if (!tool) {
      throw new Error('Tool name is required');
    }

    const mcpServer = new MpesaMCPServer();
    const result = await mcpServer.call(tool, parameters);

    return new Response(JSON.stringify(result), {
      headers: { 
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });

  } catch (error) {
    console.error('Error in M-Pesa MCP Server:', error);
    
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    }), {
      status: 500,
      headers: { 
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
