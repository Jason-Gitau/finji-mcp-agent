// Enhanced M-Pesa MCP Server - Key Improvements
// Added rate limiting, better error handling, and optimized patterns

export class EnhancedMpesaMCPServer extends MpesaMCPServer {
  
  // 1. ENHANCED TRANSACTION PARSING with 2025 M-Pesa formats
  private async extractTransactions(rawText: string): Promise<MpesaTransaction[]> {
    const apiKey = Deno.env.get('GEMINI_API_KEY')!;
    
    // Updated prompt with latest M-Pesa formats
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
      
      // Enhanced validation and processing
      return this.validateAndEnhanceTransactions(transactions);
      
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

  // 3. ENHANCED CATEGORIZATION with 2025 business context
  private getEnhanced2025BusinessCategories() {
    return {
      // Income categories
      income: {
        sales: ["customer", "client", "payment", "order", "invoice", "bill", "purchase"],
        service_income: ["consultation", "service", "repair", "maintenance", "professional"],
        digital_sales: ["mpesa", "online", "app", "digital", "e-commerce"],
        rental_income: ["rent", "lease", "property", "space"],
        investment_returns: ["dividend", "interest", "profit", "return"]
      },
      
      // Expense categories (Kenya-specific 2025)
      inventory: ["wholesaler", "supplier", "stock", "goods", "inventory", "raw materials", "crates", "bags", "kilos"],
      
      utilities: {
        electricity: ["kplc", "kenya power", "electricity", "power", "prepaid"],
        water: ["nairobi water", "water", "sewerage", "county water"],
        internet: ["safaricom", "airtel", "telkom", "zuku", "internet", "wifi", "data"],
        gas: ["gas", "cooking gas", "lpg", "meko"]
      },
      
      transport: ["matatu", "fuel", "petrol", "diesel", "uber", "bolt", "little", "transport", "travel", "fare"],
      
      rent_property: ["landlord", "rent", "deposit", "caretaker", "property", "lease"],
      
      staff_costs: {
        salaries: ["salary", "wage", "employee", "staff", "payroll"],
        benefits: ["nhif", "nssf", "insurance", "medical", "allowance"],
        casual_labor: ["casual", "daily", "piece work", "construction"]
      },
      
      tax_compliance: ["kra", "tax", "pin", "vat", "paye", "withholding", "permit", "license"],
      
      marketing: ["advertise", "promotion", "flyer", "billboard", "radio", "facebook", "google ads", "influencer"],
      
      banking_finance: ["loan", "interest", "bank charges", "processing", "mpesa charges", "equity", "kcb", "coop"],
      
      // 2025 specific categories
      digital_services: ["zoom", "microsoft", "google", "canva", "website", "domain", "hosting"],
      ecommerce: ["jumia", "kilimall", "amazon", "shipping", "courier", "logistics"],
      health_safety: ["covid", "sanitizer", "mask", "vaccine", "medical", "clinic", "hospital"]
    };
  }

  // 4. ENHANCED ANOMALY DETECTION
  private async detectAnomalies(params: any): Promise<any> {
    const transactions = params.transaction_batch || await this.getRecentTransactions(params.business_id);
    const businessProfile = await this.getBusinessProfile(params.business_id);
    
    const anomalies = [];
    const enhancedChecks = {
      // Existing checks
      ...this.getBasicAnomalyChecks(transactions, businessProfile, params.sensitivity),
      
      // New 2025-specific checks
      mpesa_fraud_patterns: this.checkMpesaFraudPatterns(transactions),
      unusual_cross_network: this.checkCrossNetworkAnomalies(transactions),
      fuliza_overuse: this.checkFulizaPatterns(transactions),
      international_transfers: this.checkInternationalAnomalies(transactions),
      rapid_consecutive: this.checkRapidConsecutiveTransactions(transactions, 300), // 5 minutes
      round_number_fraud: this.checkRoundNumberFraud(transactions)
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
      anomalies: anomalies.sort((a, b) => b.risk_score - a.risk_score), // Sort by risk
      risk_level: this.assessOverallRisk(anomalies),
      business_id: params.business_id,
      analysis_timestamp: new Date().toISOString()
    };
  }

  // 5. RATE LIMITING & API OPTIMIZATION
  private async callGeminiWithRetry(prompt: string, maxRetries: number = 3): Promise<Response> {
    const apiKey = Deno.env.get('GEMINI_API_KEY')!;
    
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
              },
              safetySettings: [
                {
                  category: "HARM_CATEGORY_FINANCIAL",
                  threshold: "BLOCK_NONE"
                }
              ]
            })
          }
        );

        if (response.ok) {
          return response;
        }

        if (response.status === 429) {
          // Rate limited - exponential backoff
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

  // 6. ENHANCED VALIDATION
  private validateAndEnhanceTransactions(transactions: any[]): MpesaTransaction[] {
    return transactions
      .filter(t => this.isValidTransaction(t))
      .map(t => ({
        ...t,
        id: t.id || `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        date: new Date(t.date),
        amount: this.parseAmount(t.amount),
        balance_after: this.parseAmount(t.balance_after),
        transaction_cost: this.parseAmount(t.transaction_cost || 0),
        counterparty: this.cleanCounterpartyName(t.counterparty),
        counterparty_phone: this.standardizePhoneNumber(t.counterparty_phone),
        confidence_score: Math.min(Math.max(t.confidence_score || 0.8, 0), 1),
        network: t.network || 'mpesa'
      }));
  }

  private isValidTransaction(t: any): boolean {
    return !!(
      t.transaction_id &&
      t.amount &&
      t.date &&
      t.type &&
      ['received', 'sent', 'withdraw', 'deposit', 'paybill', 'buy_goods', 'airtime', 'fuliza'].includes(t.type)
    );
  }

  private parseAmount(amount: any): number {
    if (typeof amount === 'number') return amount;
    const cleanAmount = String(amount).replace(/[,\s]/g, '');
    return parseFloat(cleanAmount) || 0;
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

  // Helper methods for new anomaly checks
  private checkMpesaFraudPatterns(transactions: any[]): Function {
    return (transaction: any) => {
      // Check for common M-Pesa fraud patterns
      const suspiciousNames = ['test', 'unknown', 'fraud', 'scam'];
      const name = transaction.counterparty?.toLowerCase() || '';
      
      return suspiciousNames.some(pattern => name.includes(pattern)) ||
             transaction.amount === 1 || // Penny testing
             (transaction.type === 'sent' && transaction.amount > 50000 && transaction.confidence_score < 0.7);
    };
  }

  private checkRoundNumberFraud(transactions: any[]): Function {
    return (transaction: any) => {
      // Many fraudulent transactions use round numbers
      const amount = transaction.amount;
      return amount > 1000 && 
             amount % 1000 === 0 && 
             transaction.type === 'sent' &&
             !['rent', 'salary', 'loan'].some(keyword => 
               transaction.reference?.toLowerCase().includes(keyword)
             );
    };
  }

  private requiresImmediateAttention(anomalyTypes: string[]): boolean {
    const criticalAnomalies = [
      'mpesa_fraud_patterns',
      'unusual_large_amount',
      'rapid_consecutive',
      'suspicious_counterparty'
    ];
    
    return anomalyTypes.some(type => criticalAnomalies.includes(type));
  }
}
