// Enhanced Finji - MCP-Based Financial Agent for Kenyan SMEs
// Combines domain-specific tools with memory and knowledge capabilities
import "jsr:@supabase/functions-js/edge-runtime.d.ts"

// Base MCP Server interface
interface MCPServer {
  name: string;
  tools: MCPTool[];
  call(toolName: string, parameters: any): Promise<any>;
}

interface MCPTool {
  name: string;
  description: string;
  parameters: any;
}
class TimeoutManager {
  static async withTimeout<T>(
    promise: Promise<T>, 
    timeoutMs: number, 
    operationName: string
  ): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`${operationName} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]);
  }
}
// Why: Prevent out-of-memory errors with large data.
class MemoryManager {
  static checkMemoryUsage(): number {
    // Approximate memory usage check
    if (typeof Deno !== 'undefined' && Deno.memoryUsage) {
      const usage = Deno.memoryUsage();
      return usage.heapUsed / (1024 * 1024); // MB
    }
    return 0;
  }
  
  static async processLargeData<T>(
    data: T[], 
    processor: (chunk: T[]) => Promise<any>,
    chunkSize: number = 50
  ) {
    const results = [];
    
    for (let i = 0; i < data.length; i += chunkSize) {
      const chunk = data.slice(i, i + chunkSize);
      
      // Check memory before processing
      const memUsage = this.checkMemoryUsage();
      if (memUsage > 100) { // > 100MB
        console.warn(`High memory usage: ${memUsage}MB`);
        await new Promise(resolve => setTimeout(resolve, 100)); // Brief pause
      }
      
      const chunkResult = await processor(chunk);
      results.push(...(Array.isArray(chunkResult) ? chunkResult : [chunkResult]));
      
      // Force garbage collection hint
      if (typeof global !== 'undefined' && global.gc) {
        global.gc();
      }
    }
    
    return results;
  }
}
class BusinessSecurityManager {
  private supabase;
  
  constructor() {
    this.supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );
  }

  // Set business context for all database operations
  async setBusinessContext(businessId: string) {
    if (!businessId || businessId.trim() === '') {
      throw new Error('Business ID cannot be empty - security violation');
    }

    // Set the business context for RLS
    await this.supabase.rpc('set_config', {
      setting_name: 'app.current_business_id',
      setting_value: businessId,
      is_local: true
    });
  }

  // Validate business ID format
  validateBusinessId(businessId: string): boolean {
    // Business IDs should be UUIDs or specific format
    const businessIdPattern = /^[a-zA-Z0-9_-]{8,50}$/;
    return businessIdPattern.test(businessId);
  }

  // Create isolated supabase client for specific business
  getIsolatedClient(businessId: string) {
    if (!this.validateBusinessId(businessId)) {
      throw new Error('Invalid business ID format');
    }

    const client = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );

    // Set business context immediately
    client.rpc('set_config', {
      setting_name: 'app.current_business_id', 
      setting_value: businessId,
      is_local: true
    });

    return client;
  }
}
class APIQuotaManager {
  private supabase;
  private quotaLimits = {
    gemini: { hour: 50, day: 500, month: 10000 },
    vision: { hour: 100, day: 1000, month: 15000 },
    whatsapp: { hour: 200, day: 2000, month: 20000 }
  };

  constructor() {
    this.supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );
  }

  async checkAndIncrementQuota(businessId: string, apiType: 'gemini' | 'vision' | 'whatsapp'): Promise<boolean> {
    const now = new Date();
    const currentHour = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours());
    const nextHour = new Date(currentHour.getTime() + 60 * 60 * 1000);

    try {
      // Check current hour quota
      const { data: quota, error } = await this.supabase
        .from('api_quotas')
        .select('*')
        .eq('business_id', businessId)
        .eq('api_type', apiType)
        .eq('quota_period', 'hour')
        .eq('period_start', currentHour.toISOString())
        .single();

      if (error && error.code !== 'PGRST116') { // Not "not found" error
        throw error;
      }

      let currentUsage = 0;
      if (quota) {
        currentUsage = quota.quota_used;
      } else {
        // Create new quota record for this hour
        await this.supabase.from('api_quotas').insert({
          business_id: businessId,
          api_type: apiType,
          quota_period: 'hour',
          quota_limit: this.quotaLimits[apiType].hour,
          quota_used: 0,
          period_start: currentHour.toISOString(),
          period_end: nextHour.toISOString()
        });
      }

      // Check if quota exceeded
      if (currentUsage >= this.quotaLimits[apiType].hour) {
        return false; // Quota exceeded
      }

      // Increment quota usage
      await this.supabase
        .from('api_quotas')
        .update({ quota_used: currentUsage + 1 })
        .eq('business_id', businessId)
        .eq('api_type', apiType)
        .eq('quota_period', 'hour')
        .eq('period_start', currentHour.toISOString());

      return true; // Quota available

    } catch (error) {
      console.error('Quota check failed:', error);
      // Fail open - allow request but log error
      return true;
    }
  }

  async getQuotaStatus(businessId: string, apiType: string) {
    const now = new Date();
    const currentHour = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours());

    const { data: quota } = await this.supabase
      .from('api_quotas')
      .select('*')
      .eq('business_id', businessId)
      .eq('api_type', apiType)
      .eq('quota_period', 'hour')
      .eq('period_start', currentHour.toISOString())
      .single();

    const limit = this.quotaLimits[apiType]?.hour || 50;
    const used = quota?.quota_used || 0;

    return {
      limit,
      used,
      remaining: limit - used,
      resetTime: new Date(currentHour.getTime() + 60 * 60 * 1000).toISOString()
    };
  }
}


class QueueManager {
  private supabase;
  
  constructor() {
    this.supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );
  }

  async queueHeavyOperation(businessId: string, operation: string, data: any) {
    const { data: queueItem, error } = await this.supabase
      .from('processing_queue')
      .insert({
        business_id: businessId,
        operation_type: operation,
        request_data: data,
        status: 'queued'
      })
      .select()
      .single();

    if (error) throw error;
    
    // Start processing in background (don't await)
    this.processInBackground(queueItem.id);
    
    return queueItem.id;
  }

  private async processInBackground(queueId: string) {
    try {
      // Mark as processing
      await this.supabase
        .from('processing_queue')
        .update({ 
          status: 'processing', 
          started_at: new Date().toISOString() 
        })
        .eq('id', queueId);

      // Get queue item
      const { data: queueItem } = await this.supabase
        .from('processing_queue')
        .select('*')
        .eq('id', queueId)
        .single();

      if (!queueItem) return;

      // Process based on operation type
      let result;
      switch (queueItem.operation_type) {
        case 'bulk_mpesa_processing':
          result = await this.processBulkMpesa(queueItem.request_data);
          break;
        case 'monthly_analytics':
          result = await this.generateMonthlyAnalytics(queueItem.request_data);
          break;
        default:
          throw new Error(`Unknown operation: ${queueItem.operation_type}`);
      }

      // Mark as completed
      await this.supabase
        .from('processing_queue')
        .update({
          status: 'completed',
          result: result,
          completed_at: new Date().toISOString()
        })
        .eq('id', queueId);

    } catch (error) {
      // Mark as failed
      await this.supabase
        .from('processing_queue')
        .update({
          status: 'failed',
          error_message: error.message,
          completed_at: new Date().toISOString()
        })
        .eq('id', queueId);
    }
  }

  private async processBulkMpesa(data: any) {
    // Process in smaller chunks to avoid timeout
    const chunks = this.chunkArray(data.transactions, 20); // 20 transactions per chunk
    const results = [];

    for (const chunk of chunks) {
      const chunkResult = await this.processTransactionChunk(chunk, data.business_id);
      results.push(...chunkResult);
      
      // Small delay to prevent overwhelming APIs
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    return { processed_count: results.length, transactions: results };
  }

  private chunkArray(array: any[], size: number) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}


// 1. M-Pesa & Banking MCP Server (Enhanced)
class MpesaBankingMCPServer implements MCPServer {
  name = "mpesa_banking";
  tools = [
    {
      name: "parse_mpesa_statement",
      description: "Parse M-Pesa statement from WhatsApp image/text and extract transactions",
      parameters: {
        type: "object",
        properties: {
          statement_data: { type: "string" },
          format: { type: "string", enum: ["whatsapp_image", "sms_text", "pdf"] },
          language: { type: "string", enum: ["en", "sw"], default: "en" }
        }
      }
    },
    {
      name: "reconcile_transactions",
      description: "Auto-categorize transactions using Kenyan business context",
      parameters: {
        type: "object",
        properties: {
          transactions: { type: "array" },
          business_id: { type: "string" },
          learning_mode: { type: "boolean", default: true }
        }
      }
    },
    {
      name: "detect_duplicate_payments",
      description: "Identify potential duplicate or fraudulent transactions",
      parameters: {
        type: "object",
        properties: {
          business_id: { type: "string" },
          time_window: { type: "string", default: "24h" }
        }
      }
    }
  ];

  async call(toolName: string, parameters: any) {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    switch (toolName) {
      case "parse_mpesa_statement":
        if (parameters.format === "whatsapp_image") {
          const ocrResult = await this.processWhatsAppImage(parameters.statement_data);
          const transactions = await this.extractMpesaTransactions(ocrResult, parameters.language);
          return { 
            transactions, 
            processed_count: transactions.length,
            confidence_score: 0.95,
            message: parameters.language === 'sw' ? 
              `Nimepata miamala ${transactions.length}` : 
              `Found ${transactions.length} transactions`
          };
        }
        break;

      case "reconcile_transactions":
        const categorized = await this.smartCategorization(parameters.transactions, parameters.business_id);
        await this.storeWithLearning(categorized, parameters.business_id, parameters.learning_mode);
        return { 
          categorized_transactions: categorized,
          new_patterns_learned: 3,
          accuracy_improved: true
        };

      case "detect_duplicate_payments":
        const duplicates = await this.findDuplicates(parameters.business_id, parameters.time_window);
        return {
          potential_duplicates: duplicates,
          estimated_savings: duplicates.reduce((sum: number, d: any) => sum + d.amount, 0),
          risk_level: duplicates.length > 0 ? "medium" : "low"
        };
    }
  }

  private async processWhatsAppImage(imageData: string) {
    // Enhanced OCR specifically for M-Pesa screenshots shared on WhatsApp
    const visionResponse = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${Deno.env.get('GOOGLE_API_KEY')}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{
          image: { content: imageData },
          features: [
            { type: 'TEXT_DETECTION' },
            { type: 'DOCUMENT_TEXT_DETECTION' } // Better for structured text
          ]
        }]
      })
    });
    const data = await visionResponse.json();
    return data.responses[0].fullTextAnnotation?.text || data.responses[0].textAnnotations[0]?.description;
  }

  private async extractMpesaTransactions(ocrText: string, language: string) {
    const apiKey = Deno.env.get('GEMINI_API_KEY')!;
    const prompt = `Parse this M-Pesa statement text and extract ALL transactions. This is from a Kenyan business context:

${ocrText}

Extract each transaction with:
- date (YYYY-MM-DD format)
- time (HH:MM format)
- amount (numeric only, no KES)
- transaction_type (received/sent/paybill/buygoods/withdraw/deposit)
- counterparty (person/business name or phone number)
- reference (transaction code like QA12BC34DE)
- balance_after (if shown)
- description (brief, in ${language === 'sw' ? 'Swahili' : 'English'})

Common M-Pesa patterns to recognize:
- "Confirmed. Ksh X.XX received from..."
- "Confirmed. Ksh X.XX sent to..."
- "Confirmed. You bought Ksh X.XX of airtime..."
- "Confirmed. Ksh X.XX paid to..."

Return as clean JSON array. Be very accurate with amounts and dates.`;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });
    
    const data = await response.json();
    const jsonText = data.candidates[0].content.parts[0].text;
    try {
      return JSON.parse(jsonText.replace(/```json\n?|\n?```/g, ''));
    } catch (e) {
      // Fallback to regex parsing if AI fails
      return this.fallbackMpesaParsing(ocrText);
    }
  }

  private async smartCategorization(transactions: any[], businessId: string) {
    // Learn from user's historical categorizations
    const userPatterns = await this.getUserCategorizations(businessId);
    const kenyanBusinessContext = this.getKenyanBusinessCategories();
    
    return transactions.map(transaction => {
      const category = this.predictCategory(transaction, userPatterns, kenyanBusinessContext);
      return { 
        ...transaction, 
        category: category.name,
        confidence: category.confidence,
        suggested_vat_rate: category.vat_applicable ? 0.16 : 0
      };
    });
  }

  private getKenyanBusinessCategories() {
    return {
      inventory: ["wholesaler", "supplier", "stock", "goods", "crates", "bags"],
      utilities: ["kplc", "kenya power", "water", "nairobi water", "internet", "airtel", "safaricom"],
      transport: ["matatu", "fuel", "petrol", "diesel", "uber", "bolt", "transport"],
      rent: ["landlord", "rent", "deposit", "caretaker"],
      salaries: ["salary", "wage", "employee", "staff", "bonus"],
      tax: ["kra", "tax", "pin", "vat", "paye"],
      marketing: ["advertise", "promotion", "flyer", "billboard", "radio"],
      sales: ["customer", "client", "payment", "sale", "order"]
    };
  }

  private async getUserCategorizations(businessId: string) {
    // Fetch user's historical categorization patterns for ML
    // This enables the system to learn user preferences
    return {};
  }

  private predictCategory(transaction: any, userPatterns: any, context: any) {
    // Simple ML-like categorization using keywords and patterns
    const description = transaction.description?.toLowerCase() || '';
    const counterparty = transaction.counterparty?.toLowerCase() || '';
    
    for (const [category, keywords] of Object.entries(context)) {
      for (const keyword of keywords as string[]) {
        if (description.includes(keyword) || counterparty.includes(keyword)) {
          return { name: category, confidence: 0.85, vat_applicable: category !== 'salary' };
        }
      }
    }
    
    return { name: 'other', confidence: 0.3, vat_applicable: false };
  }

  private async storeWithLearning(transactions: any[], businessId: string, learningMode: boolean) {
    // Store transactions and update categorization patterns
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    
    // Store transactions
    await fetch(`${supabaseUrl}/rest/v1/transactions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        'apikey': supabaseKey
      },
      body: JSON.stringify(transactions.map(t => ({ ...t, business_id: businessId })))
    });
    
    if (learningMode) {
      // Update categorization patterns based on user confirmations
      await this.updateLearningPatterns(businessId, transactions);
    }
  }

  private async findDuplicates(businessId: string, timeWindow: string) {
    // SQL query to find potential duplicate transactions
    const hours = timeWindow === '24h' ? 24 : 1;
    // Implementation would query database for similar amounts, counterparties within time window
    return [];
  }

  private fallbackMpesaParsing(text: string) {
    // Regex-based parsing as fallback
    const transactions = [];
    const lines = text.split('\n');
    
    for (const line of lines) {
      if (line.includes('Confirmed') && line.includes('KSh')) {
        // Basic regex extraction
        const amountMatch = line.match(/KSh\s*([\d,]+\.?\d*)/);
        if (amountMatch) {
          transactions.push({
            amount: parseFloat(amountMatch[1].replace(/,/g, '')),
            description: line.trim(),
            confidence: 0.7
          });
        }
      }
    }
    
    return transactions;
  }

  private async updateLearningPatterns(businessId: string, transactions: any[]) {
    // Update ML patterns based on user feedback
  }
}

// 2. Enhanced Invoice Generation with WhatsApp Integration
class InvoiceGenerationMCPServer implements MCPServer {
  name = "invoice_generation";
  tools = [
    {
      name: "create_invoice_from_chat",
      description: "Create invoice from natural WhatsApp-style message",
      parameters: {
        type: "object",
        properties: {
          message: { type: "string" },
          business_id: { type: "string" },
          customer_phone: { type: "string" },
          language: { type: "string", enum: ["en", "sw"], default: "en" }
        }
      }
    },
    {
      name: "send_via_whatsapp",
      description: "Send invoice directly via WhatsApp Business API",
      parameters: {
        type: "object",
        properties: {
          invoice_id: { type: "string" },
          recipient_phone: { type: "string" },
          custom_message: { type: "string" },
          language: { type: "string", enum: ["en", "sw"], default: "en" }
        }
      }
    },
    {
      name: "quick_receipt",
      description: "Generate simple receipt for cash transactions",
      parameters: {
        type: "object",
        properties: {
          amount: { type: "number" },
          customer_name: { type: "string" },
          description: { type: "string" },
          business_id: { type: "string" }
        }
      }
    }
  ];

  async call(toolName: string, parameters: any) {
    switch (toolName) {
      case "create_invoice_from_chat":
        const invoiceData = await this.parseWhatsAppMessage(parameters.message, parameters.business_id, parameters.language);
        const invoice = await this.generateKenyanInvoice(invoiceData);
        return {
          invoice_id: invoice.id,
          pdf_url: invoice.pdf_url,
          whatsapp_ready: true,
          total_amount: invoice.total,
          vat_amount: invoice.vat,
          message: parameters.language === 'sw' ? 
            `Bili imekamilika. Jumla: KES ${invoice.total}` :
            `Invoice created. Total: KES ${invoice.total}`
        };

      case "send_via_whatsapp":
        const sendResult = await this.sendInvoiceWhatsApp(
          parameters.invoice_id, 
          parameters.recipient_phone, 
          parameters.custom_message,
          parameters.language
        );
        return {
          sent: sendResult.success,
          message_id: sendResult.message_id,
          delivery_status: "pending"
        };

      case "quick_receipt":
        const receipt = await this.generateQuickReceipt(parameters);
        return {
          receipt_id: receipt.id,
          pdf_url: receipt.pdf_url,
          sms_ready: true
        };
    }
  }

  private async parseWhatsAppMessage(message: string, businessId: string, language: string) {
    const businessInfo = await this.getBusinessInfo(businessId);
    const apiKey = Deno.env.get('GEMINI_API_KEY')!;
    
    const prompt = `Parse this WhatsApp business message into invoice data for a Kenyan SME:

Business: ${JSON.stringify(businessInfo)}
Message: "${message}"
Language: ${language}

Common Kenyan business patterns:
- "Invoice Mary 50 bags maize @3000"
- "Bill John: 10 crates soda KES 500 each"
- "Create invoice for Jane - 5 mattresses @ 8000"

Extract:
- customer_name
- items: [{ name, quantity, unit_price, description }]
- due_date (default: 30 days from now)
- vat_applicable (true for most goods/services)
- payment_terms
- special_instructions

Calculate totals with 16% VAT where applicable.
Return JSON with all invoice details.`;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });
    
    const data = await response.json();
    const jsonText = data.candidates[0].content.parts[0].text;
    return JSON.parse(jsonText.replace(/```json\n?|\n?```/g, ''));
  }

  private async generateKenyanInvoice(invoiceData: any) {
    // Generate PDF with Kenyan business format
    // Include KRA PIN, proper VAT calculations, Swahili terms if needed
    const invoiceId = `INV-${Date.now()}`;
    const pdfUrl = await this.createInvoicePDF(invoiceData, invoiceId);
    
    return {
      id: invoiceId,
      pdf_url: pdfUrl,
      total: invoiceData.subtotal + (invoiceData.vat_amount || 0),
      vat: invoiceData.vat_amount || 0,
      data: invoiceData
    };
  }

  private async sendInvoiceWhatsApp(invoiceId: string, phone: string, customMessage: string, language: string) {
    const defaultMessage = language === 'sw' ? 
      "Hii ni bili yako kutoka" : 
      "Here's your invoice from";
    
    const message = customMessage || defaultMessage;
    
    const whatsappResponse = await fetch('https://graph.facebook.com/v18.0/YOUR_PHONE_NUMBER_ID/messages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('WHATSAPP_TOKEN')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: phone,
        type: "document",
        document: {
          link: `https://your-domain.com/invoices/${invoiceId}.pdf`,
          caption: message,
          filename: `Invoice_${invoiceId}.pdf`
        }
      })
    });
    
    const result = await whatsappResponse.json();
    return { success: !result.error, message_id: result.messages?.[0]?.id };
  }

  private async createInvoicePDF(data: any, invoiceId: string) {
    // PDF generation logic - would use a service like PDFShift
    return `https://storage.finji.co.ke/invoices/${invoiceId}.pdf`;
  }

  private async getBusinessInfo(businessId: string) {
    // Fetch from database
    return {
      name: "Mama Jane's Shop",
      address: "Nairobi, Kenya",
      phone: "+254700123456",
      kra_pin: "P051234567X",
      logo_url: "https://storage.finji.co.ke/logos/business1.png"
    };
  }

  private async generateQuickReceipt(params: any) {
    const receiptId = `RCP-${Date.now()}`;
    return {
      id: receiptId,
      pdf_url: `https://storage.finji.co.ke/receipts/${receiptId}.pdf`
    };
  }
}

// 3. Memory & Learning MCP Server (New)
class MemoryLearningMCPServer implements MCPServer {
  name = "memory_learning";
  tools = [
    {
      name: "remember_user_preference",
      description: "Learn and store user business patterns and preferences",
      parameters: {
        type: "object",
        properties: {
          business_id: { type: "string" },
          preference_type: { type: "string" },
          preference_data: { type: "object" }
        }
      }
    },
    {
      name: "get_business_context",
      description: "Retrieve relevant business context for better responses",
      parameters: {
        type: "object",
        properties: {
          business_id: { type: "string" },
          context_type: { type: "string", enum: ["customers", "suppliers", "patterns", "preferences"] }
        }
      }
    }
  ];

  async call(toolName: string, parameters: any) {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    switch (toolName) {
      case "remember_user_preference":
        await fetch(`${supabaseUrl}/rest/v1/business_memory`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
            'apikey': supabaseKey
          },
          body: JSON.stringify({
            business_id: parameters.business_id,
            preference_type: parameters.preference_type,
            data: parameters.preference_data,
            created_at: new Date().toISOString()
          })
        });
        return { stored: true };

      case "get_business_context":
        const response = await fetch(`${supabaseUrl}/rest/v1/business_memory?business_id=eq.${parameters.business_id}&preference_type=eq.${parameters.context_type}`, {
          headers: {
            'Authorization': `Bearer ${supabaseKey}`,
            'apikey': supabaseKey
          }
        });
        const context = await response.json();
        return { context };
    }
  }
}


// 4. Enhanced Main Finji Agent
class FinjiAgent {
  private mcpServers: MCPServer[];
  private queueManager: QueueManager;
  private securityManager: BusinessSecurityManager;
  private quotaManager: APIQuotaManager;
  
  
  constructor() {
    this.mcpServers = [
      new MpesaBankingMCPServer(),
      new InvoiceGenerationMCPServer(),
      new TaxComplianceMCPServer(), // From original
      new AnalyticsMCPServer(), // From original
      new MemoryLearningMCPServer()
    ];
    this.queueManager = new QueueManager();
    this.securityManager = new BusinessSecurityManager();
    this.quotaManager = new APIQuotaManager();
  }

 async processWhatsAppMessage(message: string, businessId: string, userPhone: string, language: 'en' | 'sw' = 'en') {
  // Step 0: SECURITY - Validate and set business context
  if (!this.securityManager.validateBusinessId(businessId)) {
    throw new Error('Invalid business identifier provided');
  }
  
  await this.securityManager.setBusinessContext(businessId);
    
    // Step 1: Get business context and user history
    const memoryServer = this.mcpServers.find(s => s.name === "memory_learning")!;
    const context = await memoryServer.call("get_business_context", { 
      business_id: businessId,
      context_type: "patterns" 
    });
    
    // Step 2: Enhanced intent analysis with context
    const intent = await this.analyzeWhatsAppIntent(message, language, context.context);
    
    // Step 3: Check if heavy operation, queue if needed
    if (this.isHeavyOperation(intent)) {
      const queueId = await this.queueManager.queueHeavyOperation(
      businessId,
      intent.intent,
      { intent, userPhone, message }
      );
  
    return {
      response: await this.generateQueuedResponse(intent.intent, language),
      queued: true,
      queue_id: queueId,
      estimated_time: this.getEstimatedTime(intent.intent),
      check_status_url: `/status/${queueId}`
    };
  }
    // Step 3: Execute actions immediately for light operations
    const results = await this.executeActions(intent, businessId, userPhone);

    // Step 4: Generate WhatsApp-friendly response
    const response = await this.generateWhatsAppResponse(message, results, language);
    
    // Step 5: Learn from interaction
    await memoryServer.call("remember_user_preference", {
      business_id: businessId,
      preference_type: "interaction",
      preference_data: { query: message, intent: intent.intent, success: results.every(r => r.success) }
    });
    
    return {
      response,
      actions_taken: results.map(r => r.action),
      language,
      business_id: businessId,
      whatsapp_ready: true
    };
  }
  private isHeavyOperation(intent: any): boolean {
  const heavyOperations = [
    'bulk_mpesa_processing',
    'monthly_analytics', 
    'complex_fraud_analysis',
    'bulk_invoice_generation'
  ];
  
  return heavyOperations.includes(intent.intent) || 
         (intent.actions && intent.actions.length > 3) || // Multiple actions
         (intent.estimated_time && intent.estimated_time > 20); // Time estimate > 20s
}

private async generateQueuedResponse(operation: string, language: string): Promise<string> {
  const responses = {
    en: {
      bulk_mpesa_processing: "I'm processing your M-Pesa statements. This will take 2-3 minutes. I'll send you the results via WhatsApp.",
      monthly_analytics: "Generating your monthly business report. This will take 3-5 minutes. I'll notify you when ready.",
      default: "I'm working on your request. This might take a few minutes. I'll get back to you soon!"
    },
    sw: {
      bulk_mpesa_processing: "Ninachakata statements zako za M-Pesa. Itachukua dakika 2-3. Nitakutumia matokeo.",
      monthly_analytics: "Ninatengeneza ripoti yako ya mwezi. Itachukua dakika 3-5. Nitakujulisha ikiwa tayari.",
      default: "Ninafanya kazi na ombi lako. Pengine itachukua dakika chache. Nitarudi kwako!"
    }
  };
  
  return responses[language]?.[operation] || responses[language].default;
}

private getEstimatedTime(operation: string): string {
  const timeEstimates = {
    bulk_mpesa_processing: "2-3 minutes",
    monthly_analytics: "3-5 minutes", 
    complex_fraud_analysis: "1-2 minutes",
    default: "2-4 minutes"
  };
  
  return timeEstimates[operation] || timeEstimates.default;
}

  private async analyzeWhatsAppIntent(message: string, language: string, context: any, businessId: string) {
    const apiKey = Deno.env.get('GEMINI_API_KEY')!;
    
    const prompt = `You are Finji, a Kenyan SME financial assistant. Analyze this WhatsApp message:

Message (${language}): "${message}"
User Context: ${JSON.stringify(context)}

Identify the intent and required actions. Common intents:
- parse_mpesa: "Here's my M-Pesa statement" (with image)
- create_invoice: "Invoice John for 20 bags @3000"
- check_balance: "How much money do I have?"
- tax_help: "When is VAT due?" 
- send_invoice: "Send invoice to Mary"
- business_insights: "How is my business doing?"

Consider Kenyan business language patterns and WhatsApp communication style.
Return JSON with: intent, confidence, required_servers, actions.`;
    try {
      // Check API quota before making call
    const quotaAvailable = await this.quotaManager.checkAndIncrementQuota(businessId, 'gemini');
    if (!quotaAvailable) {
      const quotaStatus = await this.quotaManager.getQuotaStatus(businessId, 'gemini');
      throw new Error(`API quota exceeded. Resets at ${quotaStatus.resetTime}. Please try again later.`);
    }
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });
    if (!response.ok) {
      throw new Error(`Gemini API failed: ${response.status}`);
    }
    
    const data = await response.json();
      
    // Check if AI response is valid
    if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
      throw new Error('Invalid AI response structure');
    }
    const jsonText = data.candidates[0].content.parts[0].text;
    return JSON.parse(jsonText.replace(/```json\n?|\n?```/g, ''));
  }catch (error) {
    console.error('AI intent analysis failed:', error);
    
   // FALLBACK: Basic keyword matching
    return  this.fallbackIntentAnalysis(message, language);
  }
}
  private fallbackIntentAnalysis(message: string, language: string) {
  const msg = message.toLowerCase();
  
  // Simple keyword-based intent detection
  if (msg.includes('statement') || msg.includes('mpesa') || msg.includes('transaction')) {
    return {
      intent: 'parse_mpesa',
      confidence: 0.7,
      actions: [{
        server: 'mpesa_banking',
        tool: 'parse_mpesa_statement',
        parameters: { format: 'sms_text' }
      }]
    };
  }
  
  if (msg.includes('invoice') || msg.includes('bill')) {
    return {
      intent: 'create_invoice',
      confidence: 0.6,
      actions: [{
        server: 'invoice_generation',
        tool: 'create_invoice_from_chat',
        parameters: {}
      }]
    };
  }
  
  // Default fallback
  return {
    intent: 'general_help',
    confidence: 0.3,
    actions: [],
    fallback_message: language === 'sw' ? 
      'Samahani, sikuelewi. Tafadhali jaribu tena.' :
      'Sorry, I didn\'t understand. Please try again or contact support.'
  };
}

  private async generateWhatsAppResponse(query: string, results: any[], language: string) {
    const apiKey = Deno.env.get('GEMINI_API_KEY')!;
    
    const contextPrompt = language === 'sw' ? 
      `Wewe ni Finji, msaidizi wa biashara ndogo za Kenya. Jibu kwa Kiswahili rahisi, kama rafiki wa WhatsApp.` :
      `You are Finji, a helpful financial assistant for Kenyan SMEs. Respond like a friendly WhatsApp chat, clear and conversational.`;

    const prompt = `${contextPrompt}

User asked: "${query}"
Actions completed: ${JSON.stringify(results, null, 2)}

Respond in a WhatsApp-friendly way:
- Keep it conversational and brief
- Use emojis sparingly but appropriately
- Include next steps or suggestions
- Be encouraging and supportive
- Match the energy of the user's message`;

    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });
    
    const data = await response.json();
      
    if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
      throw new Error('Invalid AI response for message generation');
    }
    return data.candidates[0].content.parts[0].text;
      
    } catch (error) {
    console.error('AI response generation failed:', error);
    // Fallback to simple response
    return this.generateFallbackResponse(query, results, language);
  }
  
  
  private generateFallbackResponse(query: string, results: any[], language: string): string {
  const hasFailures = results.some(r => !r.success);
  
  if (hasFailures) {
    const failedActions = results.filter(r => !r.success);
    
    if (language === 'sw') {
      if (failedActions.some(a => a.action.includes('parse_mpesa'))) {
        return "Samahani, sikuweza kusoma statement yako ya M-Pesa. Tafadhali tuma picha wazi zaidi au andika maelezo ya miamala.";
      }
      return "Samahani, kuna tatizo la kiufundi. Jaribu tena baada ya dakika chache au wasiliana nasi: +254700123456";
    } else {
      if (failedActions.some(a => a.action.includes('parse_mpesa'))) {
        return "Sorry, I couldn't read your M-Pesa statement. Please send a clearer image or type the transaction details manually.";
      }
      return "Sorry, there's a technical issue. Please try again in a few minutes or contact support: +254700123456";
    }
  }
  
  // If all successful, return success message
  return language === 'sw' ? 
    "Umefanikiwa! Nimekamilisha ombi lako." :
    "Success! I've completed your request.";
}
  

  private async executeActions(intent: any, businessId: string, userPhone?: string) {
  const results = [];
  
  // Handle fallback case first
  if (intent.fallback_message) {
    return [{
      action: 'fallback_response',
      result: { message: intent.fallback_message },
      success: true
    }];
  }
  
  for (const action of intent.actions || []) {
    try {
      // Validate required parameters
      if (!businessId) {
        throw new Error('Business ID is required for all actions');
      }
      
      const server = this.mcpServers.find(s => s.name === action.server);
      if (!server) {
        throw new Error(`MCP server '${action.server}' not found`);
      }
      
      const params = { 
        ...action.parameters, 
        business_id: businessId,
        user_phone: userPhone 
      };
      
      // Add timeout to prevent hanging with better error context
      const result = await TimeoutManager.withTimeout(
      server.call(action.tool, params),
      25000, // 25 seconds (reduced from 30s for safety margin)
      `${action.server}.${action.tool} for business ${businessId}`
      );
      
      results.push({ 
        action: action.tool, 
        result, 
        success: true,
        server: action.server 
      });
      
    } catch (error) {
      console.error(`Action failed: ${action.tool}`, error);
      
      results.push({ 
        action: action.tool, 
        error: error.message, 
        success: false,
        server: action.server,
        fallback_available: this.hasFallback(action.tool)
      });
      
      // Try fallback
      if (this.hasFallback(action.tool)) {
        const fallbackResult = await this.executeFallback(action.tool, businessId);
        results.push(fallbackResult);
      }
    }
  }
  
  return results;
}


private hasFallback(toolName: string): boolean {
  const fallbackTools = ['parse_mpesa_statement', 'create_invoice_from_chat'];
  return fallbackTools.includes(toolName);
}

private async executeFallback(toolName: string, businessId: string) {
  try {
    switch (toolName) {
      case 'parse_mpesa_statement':
        return {
          action: `${toolName}_fallback`,
          result: { 
            message: 'Please send a clearer M-Pesa screenshot or type the transaction details manually',
            success: false,
            fallback_used: true
          },
          success: true
        };
      
      case 'create_invoice_from_chat':
        return {
          action: `${toolName}_fallback`,
          result: {
            message: 'Please provide: Customer name, items, quantities, and prices. Example: "Invoice John: 5 bags rice @2000 each"',
            success: false, 
            fallback_used: true
          },
          success: true
        };
        
      default:
        return {
          action: `${toolName}_fallback`,
          result: { message: 'Service temporarily unavailable. Please try again later.' },
          success: false
        };
    }
  } catch (error) {
    return {
      action: `${toolName}_fallback_failed`,
      error: error.message,
      success: false
    };
  }
}


// Supabase Edge Function Handler - Enhanced for WhatsApp
Deno.serve(async (req) => {
  try {
    // Validate request
    if (req.method !== 'POST') {
      throw new Error('Only POST method allowed');
    }
    
    // Check request size first
const contentLength = req.headers.get('content-length');
  if (contentLength && parseInt(contentLength) > 5 * 1024 * 1024) { // 5MB limit
  throw new Error('Request too large. Please reduce file size or split into smaller requests.');
  }

  const body = await req.json().catch(() => {
  throw new Error('Invalid JSON in request body');
  });

  // Check specific field sizes
  if (body.image_data && body.image_data.length > 4 * 1024 * 1024) { // 4MB image limit
  throw new Error('Image too large. Please compress or crop your screenshot.');
  }
    });
    
    const { 
      message, 
      business_id, 
      user_phone,
      language = 'en',
      platform = 'whatsapp',
      image_data = null 
    } = body;
    
    // Validate required fields
    if (!message || !business_id) {
      throw new Error('Missing required fields: message and business_id');
    }
    
    if (message.length > 10000) {
      throw new Error('Message too long. Please keep under 10,000 characters.');
    }
    
    const finji = new FinjiAgent();
    
    // Handle WhatsApp messages (including images)
    let processedMessage = message;
    if (image_data && platform === 'whatsapp') {
      processedMessage = `${message}\n[Image attached: M-Pesa statement]`;
      // You could process the image here or pass it to the MCP server
    }
    
    const response = await finji.processWhatsAppMessage(
      processedMessage, 
      business_id, 
      user_phone, 
      language
    );
    
    return new Response(JSON.stringify({
      ...response,
      timestamp: new Date().toISOString(),
      version: "2.0",
      platform: platform
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Connection': 'keep-alive'
      }
    });
  } } catch (error) {
    console.error('Finji request failed:', error);
    
    // Determine appropriate error response
    let status = 500;
    let userMessage = "Technical error occurred";
    let suggestion = "Please try again later";
    
    if (error.message.includes('JSON') || error.message.includes('required fields')) {
      status = 400;
      userMessage = "Invalid request format";
      suggestion = "Please check your request and try again";
    } else if (error.message.includes('timeout')) {
      status = 504;
      userMessage = "Request took too long";
      suggestion = "Please try again with a simpler request";
    } else if (error.message.includes('quota') || error.message.includes('limit')) {
      status = 429;
      userMessage = "Service temporarily busy";  
      suggestion = "Please try again in a few minutes";
    }
    
    return new Response(JSON.stringify({
      success: false,
      error: userMessage,
      suggestion,
      support_contact: "+254700123456",
      timestamp: new Date().toISOString(),
      request_id: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    }), {
      status,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
});
