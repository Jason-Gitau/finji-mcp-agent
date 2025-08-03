// Enhanced Supabase Edge Function for Finji Invoice MCP Server
// With Kenya-specific features and WhatsApp integration
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Types for invoice data
interface InvoiceItem {
  id: string;
  description: string;
  description_sw?: string; // Swahili description
  quantity: number;
  unit_price: number;
  tax_rate: number;
  vat_inclusive: boolean;
  total: number;
  category?: string; // For analytics
}

interface Invoice {
  id: string;
  invoice_number: string;
  client_id: string;
  client_name: string;
  client_email: string;
  client_phone?: string;
  client_address: string;
  client_kra_pin?: string;
  issue_date: string;
  due_date: string;
  items: InvoiceItem[];
  subtotal: number;
  vat_amount: number;
  total_amount: number;
  status: 'draft' | 'sent' | 'paid' | 'overdue' | 'partially_paid' | 'cancelled';
  payment_method?: 'mpesa' | 'bank' | 'cash' | 'other';
  mpesa_code?: string;
  amount_paid: number;
  notes?: string;
  notes_sw?: string; // Swahili notes
  payment_terms?: string;
  language: 'en' | 'sw';
  currency: string;
  business_id: string;
  template_type?: 'standard' | 'retail' | 'services' | 'trading';
  created_at: string;
  updated_at: string;
  sent_at?: string;
  paid_at?: string;
  reminder_count: number;
  last_reminder_at?: string;
}

interface Client {
  id: string;
  name: string;
  business_name_swahili?: string;
  email: string;
  phone: string;
  address: string;
  kra_pin?: string;
  preferred_language: 'en' | 'sw';
  business_type?: 'retail' | 'services' | 'trading' | 'manufacturing' | 'other';
  created_at: string;
  business_id: string;
}

interface InvoiceTemplate {
  id: string;
  name: string;
  name_sw: string;
  business_type: string;
  default_items: Omit<InvoiceItem, 'id' | 'total'>[];
  default_payment_terms: string;
  default_payment_terms_sw: string;
}

// Initialize Supabase client
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const supabase = createClient(supabaseUrl, supabaseKey);

// Constants
const KENYA_VAT_RATE = 0.16; // 16% VAT in Kenya
const DEFAULT_CURRENCY = 'KES';
const KES_CURRENCY_CODE = 'KES';

// Utility functions
function generateId(): string {
  return crypto.randomUUID();
}

async function generateInvoiceNumber(businessId: string): Promise<string> {
  const { count } = await supabase
    .from('invoices')
    .select('*', { count: 'exact', head: true })
    .eq('business_id', businessId);
  
  const nextNumber = (count || 0) + 1001;
  return `INV-${String(nextNumber).padStart(4, '0')}`;
}

// Currency formatting for Kenya
function formatKES(amount: number): string {
  return `KES ${amount.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// KRA PIN validation
function validateKRAPIN(pin: string): boolean {
  if (!pin) return true; // Optional field
  return /^[A-Z]\d{9}[A-Z]$/.test(pin.toUpperCase());
}

// Phone number validation and formatting for Kenya
function validateAndFormatKenyanPhone(phone: string): string {
  // Remove any spaces, dashes, or plus signs
  let cleanPhone = phone.replace(/[\s\-\+]/g, '');
  
  // Handle different formats
  if (cleanPhone.startsWith('254')) {
    return '+' + cleanPhone;
  } else if (cleanPhone.startsWith('0')) {
    return '+254' + cleanPhone.substring(1);
  } else if (cleanPhone.length === 9) {
    return '+254' + cleanPhone;
  }
  
  throw new Error('Invalid Kenyan phone number format');
}

// VAT calculation helpers
function calculateVAT(amount: number, isVATInclusive: boolean = false): number {
  return isVATInclusive 
    ? amount * KENYA_VAT_RATE / (1 + KENYA_VAT_RATE) 
    : amount * KENYA_VAT_RATE;
}

function calculateItemTotal(item: Omit<InvoiceItem, 'id' | 'total'>): number {
  const subtotal = item.quantity * item.unit_price;
  
  if (item.vat_inclusive) {
    return subtotal; // Total is already inclusive of VAT
  } else {
    const vat = subtotal * (item.tax_rate || KENYA_VAT_RATE);
    return subtotal + vat;
  }
}

function calculateInvoiceTotals(items: InvoiceItem[]): { subtotal: number, vat_amount: number, total_amount: number } {
  let subtotal = 0;
  let vat_amount = 0;
  
  for (const item of items) {
    if (item.vat_inclusive) {
      const itemSubtotal = item.quantity * item.unit_price;
      const itemVAT = calculateVAT(itemSubtotal, true);
      subtotal += itemSubtotal - itemVAT;
      vat_amount += itemVAT;
    } else {
      const itemSubtotal = item.quantity * item.unit_price;
      const itemVAT = itemSubtotal * (item.tax_rate || KENYA_VAT_RATE);
      subtotal += itemSubtotal;
      vat_amount += itemVAT;
    }
  }
  
  const total_amount = subtotal + vat_amount;
  return { subtotal, vat_amount, total_amount };
}

// Parse items from natural language text
function parseItemsFromText(itemsText: string, language: 'en' | 'sw' = 'en'): Omit<InvoiceItem, 'id' | 'total'>[] {
  const items: Omit<InvoiceItem, 'id' | 'total'>[] = [];
  
  // Common patterns for both languages
  const patterns = [
    // "20 bags rice at 3000" or "20 mifuko ya mcele kwa 3000"
    /(\d+)\s+(\w+)\s+(.+?)\s+(?:at|kwa)\s+(\d+)/gi,
    // "5 services at 15000 each" or "5 huduma kwa 15000 kila moja"
    /(\d+)\s+(.+?)\s+(?:at|kwa)\s+(\d+)(?:\s+(?:each|kila\s+moja))?/gi,
    // Simple "quantity item price"
    /(\d+)\s+(.+?)\s+(\d+)/g
  ];
  
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(itemsText)) !== null) {
      const quantity = parseInt(match[1]);
      const description = match[2] + (match[3] ? ' ' + match[3] : '');
      const unitPrice = parseInt(match[match.length - 1]);
      
      if (quantity > 0 && unitPrice > 0) {
        items.push({
          description: description.trim(),
          quantity,
          unit_price: unitPrice,
          tax_rate: KENYA_VAT_RATE,
          vat_inclusive: false,
          category: inferItemCategory(description, language)
        });
      }
    }
  }
  
  return items;
}

// Infer item category from description
function inferItemCategory(description: string, language: 'en' | 'sw'): string {
  const desc = description.toLowerCase();
  
  const categories = {
    'inventory': ['bag', 'box', 'kg', 'pieces', 'units', 'mifuko', 'masanduku', 'vipande'],
    'services': ['service', 'consultation', 'repair', 'huduma', 'ushauri', 'ukarabati'],
    'transport': ['transport', 'delivery', 'shipping', 'usafiri', 'uwasilishaji'],
    'utilities': ['electricity', 'water', 'internet', 'umeme', 'maji'],
    'office': ['stationery', 'supplies', 'vifaa', 'mahitaji']
  };
  
  for (const [category, keywords] of Object.entries(categories)) {
    if (keywords.some(keyword => desc.includes(keyword))) {
      return category;
    }
  }
  
  return 'other';
}

// Get invoice templates
function getInvoiceTemplates(): InvoiceTemplate[] {
  return [
    {
      id: 'retail-template',
      name: 'Retail Shop',
      name_sw: 'Duka la Rejareja',
      business_type: 'retail',
      default_items: [
        {
          description: 'Product Sales',
          description_sw: 'Mauzo ya Bidhaa',
          quantity: 1,
          unit_price: 0,
          tax_rate: KENYA_VAT_RATE,
          vat_inclusive: true,
          category: 'inventory'
        }
      ],
      default_payment_terms: 'Payment due within 7 days',
      default_payment_terms_sw: 'Malipo yanapaswa kufanywa ndani ya siku 7'
    },
    {
      id: 'services-template',
      name: 'Service Provider',
      name_sw: 'Mtoa Huduma',
      business_type: 'services',
      default_items: [
        {
          description: 'Professional Services',
          description_sw: 'Huduma za Kitaalamu',
          quantity: 1,
          unit_price: 0,
          tax_rate: KENYA_VAT_RATE,
          vat_inclusive: false,
          category: 'services'
        }
      ],
      default_payment_terms: 'Payment due within 14 days',
      default_payment_terms_sw: 'Malipo yanapaswa kufanywa ndani ya siku 14'
    },
    {
      id: 'trading-template',
      name: 'Trading Business',
      name_sw: 'Biashara ya Bidhaa',
      business_type: 'trading',
      default_items: [
        {
          description: 'Goods Supplied',
          description_sw: 'Bidhaa Zilizotolewa',
          quantity: 1,
          unit_price: 0,
          tax_rate: KENYA_VAT_RATE,
          vat_inclusive: true,
          category: 'inventory'
        }
      ],
      default_payment_terms: 'Payment due on delivery',
      default_payment_terms_sw: 'Malipo yanapaswa kufanywa wakati wa uwasilishaji'
    }
  ];
}

// Validation functions
function validateCreateClient(data: any): Client {
  if (!data.name || !data.email || !data.phone || !data.address || !data.business_id) {
    throw new Error('Missing required fields: name, email, phone, address, business_id');
  }
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(data.email)) {
    throw new Error('Invalid email format');
  }

  if (!validateKRAPIN(data.kra_pin || '')) {
    throw new Error('Invalid KRA PIN format. Should be like A123456789B');
  }

  const formattedPhone = validateAndFormatKenyanPhone(data.phone);

  return {
    id: generateId(),
    name: data.name,
    business_name_swahili: data.business_name_swahili || null,
    email: data.email,
    phone: formattedPhone,
    address: data.address,
    kra_pin: data.kra_pin?.toUpperCase() || null,
    preferred_language: data.preferred_language || 'en',
    business_type: data.business_type || 'other',
    business_id: data.business_id,
    created_at: new Date().toISOString()
  };
}

function validateCreateInvoice(data: any): any {
  if (!data.client_id || !data.items || !Array.isArray(data.items) || !data.due_date || !data.business_id) {
    throw new Error('Missing required fields: client_id, items, due_date, business_id');
  }

  for (const item of data.items) {
    if (!item.description || typeof item.quantity !== 'number' || typeof item.unit_price !== 'number') {
      throw new Error('Invalid item format: description, quantity, and unit_price are required');
    }
    if (item.quantity <= 0 || item.unit_price <= 0) {
      throw new Error('Quantity and unit_price must be positive numbers');
    }
    if (item.tax_rate !== undefined && (item.tax_rate < 0 || item.tax_rate > 1)) {
      throw new Error('Tax rate must be between 0 and 1');
    }
  }

  return data;
}

// WhatsApp integration functions
async function sendWhatsAppInvoice(phoneNumber: string, invoiceContent: string, invoiceNumber: string): Promise<boolean> {
  try {
    const whatsappToken = Deno.env.get('WHATSAPP_TOKEN');
    const whatsappPhoneId = Deno.env.get('WHATSAPP_PHONE_ID');
    
    if (!whatsappToken || !whatsappPhoneId) {
      console.log('WhatsApp credentials not configured');
      return false;
    }

    // Clean phone number for WhatsApp API
    const cleanPhone = phoneNumber.replace('+', '');
    
    const message = {
      messaging_product: "whatsapp",
      to: cleanPhone,
      type: "text",
      text: {
        body: `📄 *${invoiceNumber}*\n\n${invoiceContent}\n\n_Sent via Finji - AI Accounting Assistant_`
      }
    };

    const response = await fetch(`https://graph.facebook.com/v18.0/${whatsappPhoneId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${whatsappToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(message)
    });

    return response.ok;
  } catch (error) {
    console.error('WhatsApp send error:', error);
    return false;
  }
}

async function sendPaymentReminder(invoice: Invoice): Promise<boolean> {
  const language = invoice.language;
  const daysSinceIssue = Math.floor((Date.now() - new Date(invoice.issue_date).getTime()) / (1000 * 60 * 60 * 24));
  const daysUntilDue = Math.floor((new Date(invoice.due_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  
  const reminderText = language === 'sw' 
    ? `🔔 *Ukumbusho wa Malipo*\n\nHujambo ${invoice.client_name},\n\nAnkara ya ${invoice.invoice_number} ya ${formatKES(invoice.total_amount)} ${daysUntilDue > 0 ? `inapaswa kulipwa ndani ya siku ${daysUntilDue}` : 'imechelewa kulipwa'}.\n\nAsante kwa uongozi wako.`
    : `🔔 *Payment Reminder*\n\nHello ${invoice.client_name},\n\nInvoice ${invoice.invoice_number} for ${formatKES(invoice.total_amount)} is ${daysUntilDue > 0 ? `due in ${daysUntilDue} days` : 'overdue'}.\n\nThank you for your business.`;

  return await sendWhatsAppInvoice(invoice.client_phone || '', reminderText, invoice.invoice_number);
}

// Enhanced PDF generation with multilingual support
function generateInvoicePDF(invoice: Invoice, language: 'en' | 'sw' = 'en'): string {
  const isSwahili = language === 'sw';
  
  const header = isSwahili ? 'ANKARA' : 'INVOICE';
  const billToLabel = isSwahili ? 'Mlipaji:' : 'Bill To:';
  const detailsLabel = isSwahili ? 'Maelezo ya Ankara:' : 'Invoice Details:';
  const issueDateLabel = isSwahili ? 'Tarehe ya Kutoa:' : 'Issue Date:';
  const dueDateLabel = isSwahili ? 'Tarehe ya Kulipa:' : 'Due Date:';
  const statusLabel = isSwahili ? 'Hali:' : 'Status:';
  const itemsLabel = isSwahili ? 'Bidhaa/Huduma:' : 'Items/Services:';
  const qtyLabel = isSwahili ? 'Idadi' : 'Qty';
  const unitPriceLabel = isSwahili ? 'Bei ya Kila' : 'Unit Price';
  const totalLabel = isSwahili ? 'Jumla' : 'Total';
  const summaryLabel = isSwahili ? 'Muhtasari:' : 'Summary:';
  const subtotalLabel = isSwahili ? 'Jumla kabla ya VAT:' : 'Subtotal:';
  const vatLabel = isSwahili ? 'VAT (16%):' : 'VAT (16%):';
  const grandTotalLabel = isSwahili ? 'JUMLA KUBWA:' : 'GRAND TOTAL:';
  const notesLabel = isSwahili ? 'Maelezo:' : 'Notes:';
  const paymentTermsLabel = isSwahili ? 'Masharti ya Malipo:' : 'Payment Terms:';
  const generatedLabel = isSwahili ? 'Imetengenezwa tarehe:' : 'Generated on:';

  const statusText = {
    'draft': isSwahili ? 'RASIMU' : 'DRAFT',
    'sent': isSwahili ? 'IMETUMWA' : 'SENT',
    'paid': isSwahili ? 'IMELIPWA' : 'PAID',
    'overdue': isSwahili ? 'IMECHELEWA' : 'OVERDUE',
    'partially_paid': isSwahili ? 'IMELIPWA SEHEMU' : 'PARTIALLY PAID',
    'cancelled': isSwahili ? 'IMEGHAIRIWA' : 'CANCELLED'
  };

  return `
${header} ${invoice.invoice_number}
${'='.repeat(50)}

${billToLabel}
${invoice.client_name}
${invoice.client_address}
${invoice.client_email}${invoice.client_phone ? `\n${invoice.client_phone}` : ''}${invoice.client_kra_pin ? `\nKRA PIN: ${invoice.client_kra_pin}` : ''}

${detailsLabel}
${issueDateLabel} ${invoice.issue_date}
${dueDateLabel} ${invoice.due_date}
${statusLabel} ${statusText[invoice.status]}${invoice.payment_method ? `\n${isSwahili ? 'Njia ya Malipo:' : 'Payment Method:'} ${invoice.payment_method.toUpperCase()}` : ''}${invoice.mpesa_code ? `\nM-Pesa Code: ${invoice.mpesa_code}` : ''}

${itemsLabel}
${'-'.repeat(80)}
${'#'.padEnd(3)} | ${'Description'.padEnd(25)} | ${qtyLabel.padEnd(8)} | ${unitPriceLabel.padEnd(12)} | ${totalLabel.padEnd(12)}
${'-'.repeat(80)}
${invoice.items.map((item: InvoiceItem, index: number) => {
  const desc = isSwahili && item.description_sw ? item.description_sw : item.description;
  return `${String(index + 1).padEnd(3)} | ${desc.substring(0, 25).padEnd(25)} | ${String(item.quantity).padEnd(8)} | ${formatKES(item.unit_price).padEnd(12)} | ${formatKES(item.total).padEnd(12)}`;
}).join('\n')}
${'-'.repeat(80)}

${summaryLabel}
${subtotalLabel} ${formatKES(invoice.subtotal)}
${vatLabel} ${formatKES(invoice.vat_amount)}
${'-'.repeat(30)}
${grandTotalLabel} ${formatKES(invoice.total_amount)}

${invoice.amount_paid > 0 ? `${isSwahili ? 'Kilicholipwa:' : 'Amount Paid:'} ${formatKES(invoice.amount_paid)}\n${isSwahili ? 'Deni:' : 'Balance Due:'} ${formatKES(invoice.total_amount - invoice.amount_paid)}\n` : ''}

${invoice.notes || invoice.notes_sw ? `${notesLabel} ${isSwahili && invoice.notes_sw ? invoice.notes_sw : invoice.notes}\n` : ''}
${invoice.payment_terms ? `${paymentTermsLabel} ${invoice.payment_terms}\n` : ''}

${generatedLabel} ${new Date().toLocaleDateString('en-KE')} ${new Date().toLocaleTimeString('en-KE')}

_${isSwahili ? 'Imetengenezwa na Finji - Msaidizi wa AI wa Hesabu' : 'Generated by Finji - AI Accounting Assistant'}_
  `.trim();
}

// Enhanced MCP Tools
const tools = [
  {
    name: "create_client",
    description: "Create a new client for invoicing with Kenya-specific validation",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Client name" },
        business_name_swahili: { type: "string", description: "Business name in Swahili (optional)" },
        email: { type: "string", description: "Client email address" },
        phone: { type: "string", description: "Client phone number (Kenyan format)" },
        address: { type: "string", description: "Client address" },
        kra_pin: { type: "string", description: "KRA PIN (optional, format: A123456789B)" },
        preferred_language: { type: "string", enum: ["en", "sw"], description: "Preferred language" },
        business_type: { type: "string", enum: ["retail", "services", "trading", "manufacturing", "other"], description: "Type of business" },
        business_id: { type: "string", description: "Business ID of the invoice creator" }
      },
      required: ["name", "email", "phone", "address", "business_id"]
    }
  },
  {
    name: "create_quick_invoice",
    description: "Create invoice from natural language text (e.g., '20 bags rice at 3000')",
    inputSchema: {
      type: "object",
      properties: {
        client_info: { type: "string", description: "Client name or phone number" },
        items_text: { type: "string", description: "Items in natural language (e.g., '20 bags rice at 3000, 5 services at 15000')" },
        business_id: { type: "string", description: "Business ID" },
        language: { type: "string", enum: ["en", "sw"], description: "Language for processing" },
        due_days: { type: "number", description: "Days until due (default: 7)", default: 7 },
        template_type: { type: "string", enum: ["retail", "services", "trading"], description: "Invoice template type" }
      },
      required: ["client_info", "items_text", "business_id"]
    }
  },
  {
    name: "create_invoice_from_template",
    description: "Create invoice using predefined templates for Kenya businesses",
    inputSchema: {
      type: "object",
      properties: {
        client_id: { type: "string", description: "Client ID" },
        template_type: { type: "string", enum: ["retail", "services", "trading"], description: "Template type" },
        business_id: { type: "string", description: "Business ID" },
        language: { type: "string", enum: ["en", "sw"], description: "Invoice language" },
        custom_items: { type: "array", description: "Custom items to override template defaults" }
      },
      required: ["client_id", "template_type", "business_id"]
    }
  },
  {
    name: "send_invoice_whatsapp",
    description: "Generate and send invoice via WhatsApp",
    inputSchema: {
      type: "object",
      properties: {
        invoice_id: { type: "string", description: "Invoice ID" },
        custom_message: { type: "string", description: "Custom message to include (optional)" }
      },
      required: ["invoice_id"]
    }
  },
  {
    name: "mark_invoice_paid_from_mpesa",
    description: "Mark invoice as paid from M-Pesa transaction",
    inputSchema: {
      type: "object",
      properties: {
        mpesa_code: { type: "string", description: "M-Pesa transaction code" },
        amount: { type: "number", description: "Amount paid" },
        phone_number: { type: "string", description: "Payer phone number" },
        business_id: { type: "string", description: "Business ID" }
      },
      required: ["mpesa_code", "amount", "phone_number", "business_id"]
    }
  },
  {
    name: "send_payment_reminder",
    description: "Send payment reminder via WhatsApp",
    inputSchema: {
      type: "object",
      properties: {
        invoice_id: { type: "string", description: "Invoice ID" }
      },
      required: ["invoice_id"]
    }
  },
  {
    name: "get_overdue_invoices",
    description: "Get list of overdue invoices for follow-up",
    inputSchema: {
      type: "object",
      properties: {
        business_id: { type: "string", description: "Business ID" },
        days_overdue: { type: "number", description: "Minimum days overdue (default: 1)", default: 1 }
      },
      required: ["business_id"]
    }
  },
  {
    name: "get_invoice_analytics",
    description: "Get detailed analytics for invoices with Kenya-specific insights",
    inputSchema: {
      type: "object",
      properties: {
        business_id: { type: "string", description: "Business ID" },
        period: { type: "string", enum: ["week", "month", "quarter", "year"], description: "Analysis period" },
        language: { type: "string", enum: ["en", "sw"], description: "Response language" }
      },
      required: ["business_id"]
    }
  },
  {
    name: "list_invoice_templates",
    description: "List available invoice templates for different business types",
    inputSchema: {
      type: "object",
      properties: {
        language: { type: "string", enum: ["en", "sw"], description: "Language for template names" }
      }
    }
  },
  // Original tools with enhancements
  {
    name: "create_invoice",
    description: "Create a detailed invoice with full Kenya compliance features",
    inputSchema: {
      type: "object",
      properties: {
        client_id: { type: "string", description: "Client ID" },
        items: {
          type: "array",
          description: "Invoice items",
          items: {
            type: "object",
            properties: {
              description: { type: "string", description: "Item description" },
              description_sw: { type: "string", description: "Item description in Swahili (optional)" },
              quantity: { type: "number", description: "Item quantity" },
              unit_price: { type: "number", description: "Unit price in KES" },
              tax_rate: { type: "number", description: "Tax rate (default: 0.16 for VAT)", default: 0.16 },
              vat_inclusive: { type: "boolean", description: "Whether price includes VAT", default: false },
              category: { type: "string", description: "Item category for analytics" }
            },
            required: ["description", "quantity", "unit_price"]
          }
        },
        due_date: { type: "string", description: "Due date (YYYY-MM-DD)" },
        language: { type: "string", enum: ["en", "sw"], description: "Invoice language", default: "en" },
        template_type: { type: "string", enum: ["standard", "retail", "services", "trading"], description: "Invoice template" },
        payment_terms: { type: "string", description: "Payment terms" },
        notes: { type: "string", description: "Invoice notes" },
        notes_sw: { type: "string", description: "Invoice notes in Swahili" },
        business_id: { type: "string", description: "Business ID" }
      },
      required: ["client_id", "items", "due_date", "business_id"]
    }
  },
  {
    name: "list_clients",
    description: "List all clients with enhanced filtering",
    inputSchema: {
      type: "object",
      properties: {
        business_id: { type: "string", description: "Business ID to filter clients" },
        business_type: { type: "string", description: "Filter by business type" },
        language: { type: "string", enum: ["en", "sw"], description: "Response language" }
      }
    }
  },
  {
    name: "get_client",
    description: "Get client details by ID",
    inputSchema: {
      type: "object",
      properties: {
        client_id: { type: "string", description: "Client ID" }
      },
      required: ["client_id"]
    }
  },
  {
    name: "list_invoices",
    description: "List all invoices with enhanced filtering",
    inputSchema: {
      type: "object",
      properties: {
        business_id: { type: "string", description: "Business ID" },
        status: { 
          type: "string", 
          enum: ["draft", "sent", "paid", "overdue", "partially_paid", "cancelled"],
          description: "Filter by invoice status (optional)" 
        },
        client_id: { type: "string", description: "Filter by client ID (optional)" },
        language: { type: "string", enum: ["en", "sw"], description: "Response language" }
      },
      required: ["business_id"]
    }
  },
  {
    name: "get_invoice",
    description: "Get invoice details by ID",
    inputSchema: {
      type: "object",
      properties: {
        invoice_id: { type: "string", description: "Invoice ID" }
      },
      required: ["invoice_id"]
    }
  },
  {
    name: "update_invoice",
    description: "Update an existing invoice",
    inputSchema: {
      type: "object",
      properties: {
        invoice_id: { type: "string", description: "Invoice ID" },
        status: { 
          type: "string", 
          enum: ["draft", "sent", "paid", "overdue", "partially_paid", "cancelled"],
          description: "Update invoice status (optional)" 
        },
        payment_method: { type: "string", enum: ["mpesa", "bank", "cash", "other"], description: "Payment method" },
        mpesa_code: { type: "string", description: "M-Pesa transaction code" },
        amount_paid: { type: "number", description: "Amount paid (for partial payments)" },
        items: {
          type: "array",
          description: "Update invoice items (optional)",
          items: {
            type: "object",
            properties: {
              description: { type: "string", description: "Item description" },
              description_sw: { type: "string", description: "Item description in Swahili" },
              quantity: { type: "number", description: "Item quantity" },
              unit_price: { type: "number", description: "Unit price" },
              tax_rate: { type: "number", description: "Tax rate (0-1)", default: 0.16 },
              vat_inclusive: { type: "boolean", description: "Whether price includes VAT" },
              category: { type: "string", description: "Item category" }
            },
            required: ["description", "quantity", "unit_price"]
          }
        },
        due_date: { type: "string", description: "Update due date (YYYY-MM-DD) (optional)" },
        notes: { type: "string", description: "Update invoice notes (optional)" },
        notes_sw: { type: "string", description: "Update invoice notes in Swahili (optional)" },
        payment_terms: { type: "string", description: "Update payment terms (optional)" }
      },
      required: ["invoice_id"]
    }
  },
  {
    name: "delete_invoice",
    description: "Delete an invoice by ID",
    inputSchema: {
      type: "object",
      properties: {
        invoice_id: { type: "string", description: "Invoice ID" }
      },
      required: ["invoice_id"]
    }
  },
  {
    name: "generate_invoice_pdf",
    description: "Generate a PDF representation of an invoice with multilingual support",
    inputSchema: {
      type: "object",
      properties: {
        invoice_id: { type: "string", description: "Invoice ID" },
        language: { type: "string", enum: ["en", "sw"], description: "PDF language", default: "en" }
      },
      required: ["invoice_id"]
    }
  },
  {
    name: "get_invoice_summary",
    description: "Get summary statistics for invoices with Kenya-specific insights",
    inputSchema: {
      type: "object",
      properties: {
        business_id: { type: "string", description: "Business ID" },
        period: { 
          type: "string", 
          enum: ["week", "month", "quarter", "year", "all"],
          description: "Time period for summary (optional, defaults to 'all')" 
        },
        language: { type: "string", enum: ["en", "sw"], description: "Response language" }
      },
      required: ["business_id"]
    }
  }
];

// Enhanced Tool handlers
async function handleTool(name: string, args: any): Promise<any> {
  try {
    switch (name) {
      case "create_client": {
        const client = validateCreateClient(args);
        const { data, error } = await supabase
          .from('clients')
          .insert([client])
          .select()
          .single();
        
        if (error) throw error;
        return {
          content: [
            {
              type: "text",
              text: `Client created successfully:\n${JSON.stringify(data, null, 2)}`
            }
          ]
        };
      }

      case "create_quick_invoice": {
        const { client_info, items_text, business_id, language = 'en', due_days = 7, template_type = 'retail' } = args;
        
        // Parse items from natural language
        const parsedItems = parseItemsFromText(items_text, language);
        if (parsedItems.length === 0) {
          throw new Error('No valid items found in the text. Try format like: "20 bags rice at 3000"');
        }

        // Find or create client
        let client;
        const isPhone = /[\+\d\-\s\(\)]{8,}/.test(client_info);
        
        if (isPhone) {
          const formattedPhone = validateAndFormatKenyanPhone(client_info);
          const { data: existingClient } = await supabase
            .from('clients')
            .select('*')
            .eq('phone', formattedPhone)
            .eq('business_id', business_id)
            .single();
          
          if (existingClient) {
            client = existingClient;
          } else {
            // Create new client with phone
            const newClient = {
              id: generateId(),
              name: `Customer ${formattedPhone}`,
              email: `customer${Date.now()}@temp.com`,
              phone: formattedPhone,
              address: 'Address to be updated',
              preferred_language: language,
              business_type: template_type,
              business_id: business_id,
              created_at: new Date().toISOString()
            };
            
            const { data, error } = await supabase
              .from('clients')
              .insert([newClient])
              .select()
              .single();
            
            if (error) throw error;
            client = data;
          }
        } else {
          // Search by name
          const { data: existingClient } = await supabase
            .from('clients')
            .select('*')
            .ilike('name', `%${client_info}%`)
            .eq('business_id', business_id)
            .single();
          
          if (!existingClient) {
            throw new Error(`Client "${client_info}" not found. Please provide phone number to create new client.`);
          }
          client = existingClient;
        }

        // Create invoice
        const items: InvoiceItem[] = parsedItems.map(item => ({
          id: generateId(),
          ...item,
          total: calculateItemTotal(item)
        }));

        const { subtotal, vat_amount, total_amount } = calculateInvoiceTotals(items);
        const invoiceNumber = await generateInvoiceNumber(business_id);
        const template = getInvoiceTemplates().find(t => t.business_type === template_type);

        const invoice = {
          id: generateId(),
          invoice_number: invoiceNumber,
          client_id: client.id,
          client_name: client.name,
          client_email: client.email,
          client_phone: client.phone,
          client_address: client.address,
          client_kra_pin: client.kra_pin,
          issue_date: new Date().toISOString().split('T')[0],
          due_date: new Date(Date.now() + due_days * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          items: items,
          subtotal,
          vat_amount,
          total_amount,
          amount_paid: 0,
          status: 'draft' as const,
          language: language,
          currency: DEFAULT_CURRENCY,
          template_type: template_type,
          payment_terms: template?.default_payment_terms || 'Payment due within 7 days',
          business_id: business_id,
          reminder_count: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };

        const { data, error } = await supabase
          .from('invoices')
          .insert([invoice])
          .select()
          .single();

        if (error) throw error;
        
        const pdfContent = generateInvoicePDF(data, language);
        
        return {
          content: [
            {
              type: "text",
              text: `✅ Quick invoice created successfully!\n\n${pdfContent}`
            }
          ]
        };
      }

      case "create_invoice_from_template": {
        const { client_id, template_type, business_id, language = 'en', custom_items } = args;
        
        const template = getInvoiceTemplates().find(t => t.business_type === template_type);
        if (!template) {
          throw new Error(`Template type "${template_type}" not found`);
        }

        // Get client
        const { data: client, error: clientError } = await supabase
          .from('clients')
          .select('*')
          .eq('id', client_id)
          .single();
        
        if (clientError || !client) {
          throw new Error(`Client with ID ${client_id} not found`);
        }

        const items: InvoiceItem[] = (custom_items || template.default_items).map((item: any) => ({
          id: generateId(),
          ...item,
          total: calculateItemTotal(item)
        }));

        const { subtotal, vat_amount, total_amount } = calculateInvoiceTotals(items);
        const invoiceNumber = await generateInvoiceNumber(business_id);

        const invoice = {
          id: generateId(),
          invoice_number: invoiceNumber,
          client_id: client.id,
          client_name: client.name,
          client_email: client.email,
          client_phone: client.phone,
          client_address: client.address,
          client_kra_pin: client.kra_pin,
          issue_date: new Date().toISOString().split('T')[0],
          due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          items: items,
          subtotal,
          vat_amount,
          total_amount,
          amount_paid: 0,
          status: 'draft' as const,
          language: language,
          currency: DEFAULT_CURRENCY,
          template_type: template_type,
          payment_terms: language === 'sw' ? template.default_payment_terms_sw : template.default_payment_terms,
          business_id: business_id,
          reminder_count: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };

        const { data, error } = await supabase
          .from('invoices')
          .insert([invoice])
          .select()
          .single();

        if (error) throw error;
        return {
          content: [
            {
              type: "text",
              text: `Template invoice created successfully:\n${JSON.stringify(data, null, 2)}`
            }
          ]
        };
      }

      case "send_invoice_whatsapp": {
        const { invoice_id, custom_message } = args;
        
        const { data: invoice, error } = await supabase
          .from('invoices')
          .select('*')
          .eq('id', invoice_id)
          .single();
        
        if (error || !invoice) {
          throw new Error(`Invoice with ID ${invoice_id} not found`);
        }

        if (!invoice.client_phone) {
          throw new Error('Client phone number not available for WhatsApp');
        }

        const pdfContent = generateInvoicePDF(invoice, invoice.language);
        const fullMessage = custom_message ? `${custom_message}\n\n${pdfContent}` : pdfContent;
        
        const sent = await sendWhatsAppInvoice(invoice.client_phone, fullMessage, invoice.invoice_number);
        
        if (sent) {
          // Update invoice status to sent
          await supabase
            .from('invoices')
            .update({ 
              status: 'sent', 
              sent_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
            .eq('id', invoice_id);
        }

        return {
          content: [
            {
              type: "text",
              text: sent 
                ? `✅ Invoice ${invoice.invoice_number} sent successfully via WhatsApp to ${invoice.client_phone}`
                : `❌ Failed to send invoice via WhatsApp. Please check WhatsApp configuration.`
            }
          ]
        };
      }

      case "mark_invoice_paid_from_mpesa": {
        const { mpesa_code, amount, phone_number, business_id } = args;
        
        const formattedPhone = validateAndFormatKenyanPhone(phone_number);
        
        // Find pending invoices for this client
        const { data: invoices, error } = await supabase
          .from('invoices')
          .select('*')
          .eq('client_phone', formattedPhone)
          .eq('business_id', business_id)
          .in('status', ['sent', 'overdue', 'partially_paid'])
          .order('due_date', { ascending: true });
        
        if (error || !invoices.length) {
          throw new Error('No pending invoices found for this phone number');
        }

        // Find best matching invoice (exact amount or closest)
        let targetInvoice = invoices.find(inv => Math.abs(inv.total_amount - inv.amount_paid - amount) < 1);
        if (!targetInvoice) {
          targetInvoice = invoices[0]; // Use oldest invoice
        }

        const newAmountPaid = targetInvoice.amount_paid + amount;
        const newStatus = newAmountPaid >= targetInvoice.total_amount ? 'paid' : 'partially_paid';

        const updates = {
          amount_paid: newAmountPaid,
          status: newStatus,
          payment_method: 'mpesa',
          mpesa_code: mpesa_code,
          updated_at: new Date().toISOString(),
          ...(newStatus === 'paid' && { paid_at: new Date().toISOString() })
        };

        const { data, error: updateError } = await supabase
          .from('invoices')
          .update(updates)
          .eq('id', targetInvoice.id)
          .select()
          .single();

        if (updateError) throw updateError;

        return {
          content: [
            {
              type: "text",
              text: `✅ Payment recorded! Invoice ${targetInvoice.invoice_number} updated.\nAmount: ${formatKES(amount)}\nM-Pesa Code: ${mpesa_code}\nStatus: ${newStatus.toUpperCase()}\nBalance: ${formatKES(targetInvoice.total_amount - newAmountPaid)}`
            }
          ]
        };
      }

      case "send_payment_reminder": {
        const { invoice_id } = args;
        
        const { data: invoice, error } = await supabase
          .from('invoices')
          .select('*')
          .eq('id', invoice_id)
          .single();
        
        if (error || !invoice) {
          throw new Error(`Invoice with ID ${invoice_id} not found`);
        }

        if (!invoice.client_phone) {
          throw new Error('Client phone number not available for reminder');
        }

        if (invoice.status === 'paid') {
          throw new Error('Invoice is already paid');
        }

        const sent = await sendPaymentReminder(invoice);
        
        if (sent) {
          await supabase
            .from('invoices')
            .update({ 
              reminder_count: invoice.reminder_count + 1,
              last_reminder_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
            .eq('id', invoice_id);
        }

        return {
          content: [
            {
              type: "text",
              text: sent 
                ? `✅ Payment reminder sent successfully to ${invoice.client_name} (${invoice.client_phone})`
                : `❌ Failed to send payment reminder. Please check WhatsApp configuration.`
            }
          ]
        };
      }

      case "get_overdue_invoices": {
        const { business_id, days_overdue = 1 } = args;
        
        const overdueDate = new Date();
        overdueDate.setDate(overdueDate.getDate() - days_overdue);
        
        const { data: invoices, error } = await supabase
          .from('invoices')
          .select('*')
          .eq('business_id', business_id)
          .in('status', ['sent', 'partially_paid'])
          .lt('due_date', overdueDate.toISOString().split('T')[0])
          .order('due_date', { ascending: true });
        
        if (error) throw error;

        // Update status to overdue
        for (const invoice of invoices) {
          await supabase
            .from('invoices')
            .update({ status: 'overdue', updated_at: new Date().toISOString() })
            .eq('id', invoice.id);
        }

        const totalOverdue = invoices.reduce((sum, inv) => sum + (inv.total_amount - inv.amount_paid), 0);

        return {
          content: [
            {
              type: "text",
              text: `📊 Overdue Invoices (${days_overdue}+ days):\n\nCount: ${invoices.length}\nTotal Amount: ${formatKES(totalOverdue)}\n\n${invoices.map(inv => 
                `• ${inv.invoice_number} - ${inv.client_name}\n  Amount: ${formatKES(inv.total_amount - inv.amount_paid)}\n  Due: ${inv.due_date}\n  Phone: ${inv.client_phone || 'N/A'}`
              ).join('\n\n')}`
            }
          ]
        };
      }

      case "get_invoice_analytics": {
        const { business_id, period = 'month', language = 'en' } = args;
        
        let dateFilter = '';
        const now = new Date();
        
        switch (period) {
          case 'week':
            const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            dateFilter = weekAgo.toISOString().split('T')[0];
            break;
          case 'month':
            const monthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
            dateFilter = monthAgo.toISOString().split('T')[0];
            break;
          case 'quarter':
            const quarterAgo = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
            dateFilter = quarterAgo.toISOString().split('T')[0];
            break;
          case 'year':
            const yearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
            dateFilter = yearAgo.toISOString().split('T')[0];
            break;
        }

        let query = supabase
          .from('invoices')
          .select('*')
          .eq('business_id', business_id);
        
        if (dateFilter) {
          query = query.gte('created_at', dateFilter);
        }

        const { data: invoices, error } = await query;
        if (error) throw error;

        const analytics = {
          period: period,
          total_invoices: invoices.length,
          total_amount: invoices.reduce((sum, inv) => sum + inv.total_amount, 0),
          paid_amount: invoices.filter(inv => inv.status === 'paid').reduce((sum, inv) => sum + inv.total_amount, 0),
          pending_amount: invoices.filter(inv => !['paid', 'cancelled'].includes(inv.status)).reduce((sum, inv) => sum + (inv.total_amount - inv.amount_paid), 0),
          overdue_amount: invoices.filter(inv => inv.status === 'overdue').reduce((sum, inv) => sum + (inv.total_amount - inv.amount_paid), 0),
          by_status: {
            draft: invoices.filter(inv => inv.status === 'draft').length,
            sent: invoices.filter(inv => inv.status === 'sent').length,
            paid: invoices.filter(inv => inv.status === 'paid').length,
            overdue: invoices.filter(inv => inv.status === 'overdue').length,
            partially_paid: invoices.filter(inv => inv.status === 'partially_paid').length,
            cancelled: invoices.filter(inv => inv.status === 'cancelled').length
          },
          by_payment_method: {
            mpesa: invoices.filter(inv => inv.payment_method === 'mpesa').length,
            bank: invoices.filter(inv => inv.payment_method === 'bank').length,
            cash: invoices.filter(inv => inv.payment_method === 'cash').length,
            other: invoices.filter(inv => inv.payment_method === 'other').length
          },
          vat_collected: invoices.filter(inv => inv.status === 'paid').reduce((sum, inv) => sum + inv.vat_amount, 0),
          average_invoice_value: invoices.length > 0 ? invoices.reduce((sum, inv) => sum + inv.total_amount, 0) / invoices.length : 0,
          payment_efficiency: invoices.length > 0 ? (invoices.filter(inv => inv.status === 'paid').length / invoices.length) * 100 : 0
        };

        const isSwahili = language === 'sw';
        const report = isSwahili 
          ? `📊 Takwimu za Ankara (${period}):

Jumla ya Ankara: ${analytics.total_invoices}
Kiasi cha Jumla: ${formatKES(analytics.total_amount)}
Kilicholipwa: ${formatKES(analytics.paid_amount)}
Kilichobaki: ${formatKES(analytics.pending_amount)}
Kilichochelewa: ${formatKES(analytics.overdue_amount)}

Kwa Hali:
• Rasimu: ${analytics.by_status.draft}
• Imetumwa: ${analytics.by_status.sent}
• Imelipwa: ${analytics.by_status.paid}
• Imechelewa: ${analytics.by_status.overdue}
• Imelipwa Sehemu: ${analytics.by_status.partially_paid}

VAT Iliyokusanywa: ${formatKES(analytics.vat_collected)}
Wastani wa Ankara: ${formatKES(analytics.average_invoice_value)}
Ufanisi wa Malipo: ${analytics.payment_efficiency.toFixed(1)}%`
          : `📊 Invoice Analytics (${period}):

Total Invoices: ${analytics.total_invoices}
Total Amount: ${formatKES(analytics.total_amount)}
Paid Amount: ${formatKES(analytics.paid_amount)}
Pending Amount: ${formatKES(analytics.pending_amount)}
Overdue Amount: ${formatKES(analytics.overdue_amount)}

By Status:
• Draft: ${analytics.by_status.draft}
• Sent: ${analytics.by_status.sent}
• Paid: ${analytics.by_status.paid}
• Overdue: ${analytics.by_status.overdue}
• Partially Paid: ${analytics.by_status.partially_paid}

VAT Collected: ${formatKES(analytics.vat_collected)}
Average Invoice Value: ${formatKES(analytics.average_invoice_value)}
Payment Efficiency: ${analytics.payment_efficiency.toFixed(1)}%`;

        return {
          content: [
            {
              type: "text",
              text: report
            }
          ]
        };
      }

      case "list_invoice_templates": {
        const { language = 'en' } = args;
        const templates = getInvoiceTemplates();
        
        const templateList = templates.map(template => ({
          id: template.id,
          name: language === 'sw' ? template.name_sw : template.name,
          business_type: template.business_type,
          default_payment_terms: language === 'sw' ? template.default_payment_terms_sw : template.default_payment_terms
        }));

        return {
          content: [
            {
              type: "text",
              text: `Available Invoice Templates:\n${JSON.stringify(templateList, null, 2)}`
            }
          ]
        };
      }

      case "list_clients": {
        const { business_id, business_type, language = 'en' } = args;
        
        let query = supabase
          .from('clients')
          .select('*')
          .order('created_at', { ascending: false });
        
        if (business_id) {
          query = query.eq('business_id', business_id);
        }
        if (business_type) {
          query = query.eq('business_type', business_type);
        }

        const { data, error } = await query;
        if (error) throw error;

        return {
          content: [
            {
              type: "text",
              text: `Clients (${data.length}):\n${JSON.stringify(data, null, 2)}`
            }
          ]
        };
      }

      case "get_client": {
        const { data, error } = await supabase
          .from('clients')
          .select('*')
          .eq('id', args.client_id)
          .single();
        
        if (error) throw error;
        if (!data) throw new Error(`Client with ID ${args.client_id} not found`);
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data, null, 2)
            }
          ]
        };
      }

      case "create_invoice": {
        const validated = validateCreateInvoice(args);
        
        // Check if client exists
        const { data: client, error: clientError } = await supabase
          .from('clients')
          .select('*')
          .eq('id', validated.client_id)
          .single();
        
        if (clientError || !client) {
          throw new Error(`Client with ID ${validated.client_id} not found`);
        }

        const items: InvoiceItem[] = validated.items.map((item: any) => ({
          id: generateId(),
          description: item.description,
          description_sw: item.description_sw || null,
          quantity: item.quantity,
          unit_price: item.unit_price,
          tax_rate: item.tax_rate || KENYA_VAT_RATE,
          vat_inclusive: item.vat_inclusive || false,
          category: item.category || 'other',
          total: calculateItemTotal({
            description: item.description,
            quantity: item.quantity,
            unit_price: item.unit_price,
            tax_rate: item.tax_rate || KENYA_VAT_RATE,
            vat_inclusive: item.vat_inclusive || false
          })
        }));

        const { subtotal, vat_amount, total_amount } = calculateInvoiceTotals(items);
        const invoiceNumber = await generateInvoiceNumber(validated.business_id);

        const invoice = {
          id: generateId(),
          invoice_number: invoiceNumber,
          client_id: client.id,
          client_name: client.name,
          client_email: client.email,
          client_phone: client.phone,
          client_address: client.address,
          client_kra_pin: client.kra_pin,
          issue_date: new Date().toISOString().split('T')[0],
          due_date: validated.due_date,
          items: items,
          subtotal,
          vat_amount,
          total_amount,
          amount_paid: 0,
          status: 'draft' as const,
          language: validated.language || 'en',
          currency: DEFAULT_CURRENCY,
          template_type: validated.template_type || 'standard',
          notes: validated.notes || null,
          notes_sw: validated.notes_sw || null,
          payment_terms: validated.payment_terms || null,
          business_id: validated.business_id,
          reminder_count: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };

        const { data, error } = await supabase
          .from('invoices')
          .insert([invoice])
          .select()
          .single();

        if (error) throw error;
        return {
          content: [
            {
              type: "text",
              text: `Invoice created successfully:\n${JSON.stringify(data, null, 2)}`
            }
          ]
        };
      }

      case "list_invoices": {
        const { business_id, status, client_id, language = 'en' } = args;
        
        let query = supabase
          .from('invoices')
          .select('*')
          .eq('business_id', business_id)
          .order('created_at', { ascending: false });
        
        if (status) {
          query = query.eq('status', status);
        }
        if (client_id) {
          query = query.eq('client_id', client_id);
        }

        const { data, error } = await query;
        if (error) throw error;

        return {
          content: [
            {
              type: "text",
              text: `Invoices (${data.length}):\n${JSON.stringify(data, null, 2)}`
            }
          ]
        };
      }

      case "get_invoice": {
        const { data, error } = await supabase
          .from('invoices')
          .select('*')
          .eq('id', args.invoice_id)
          .single();
        
        if (error) throw error;
        if (!data) throw new Error(`Invoice with ID ${args.invoice_id} not found`);
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data, null, 2)
            }
          ]
        };
      }

      case "update_invoice": {
        const { data: existingInvoice, error: fetchError } = await supabase
          .from('invoices')
          .select('*')
          .eq('id', args.invoice_id)
          .single();
        
        if (fetchError || !existingInvoice) {
          throw new Error(`Invoice with ID ${args.invoice_id} not found`);
        }

        const updates: any = {
          updated_at: new Date().toISOString()
        };

        if (args.status) updates.status = args.status;
        if (args.payment_method) updates.payment_method = args.payment_method;
        if (args.mpesa_code) updates.mpesa_code = args.mpesa_code;
        if (args.amount_paid !== undefined) {
          updates.amount_paid = args.amount_paid;
          // Auto-update status based on payment
          if (args.amount_paid >= existingInvoice.total_amount) {
            updates.status = 'paid';
            updates.paid_at = new Date().toISOString();
          } else if (args.amount_paid > 0) {
            updates.status = 'partially_paid';
          }
        }
        if (args.due_date) updates.due_date = args.due_date;
        if (args.notes !== undefined) updates.notes = args.notes;
        if (args.notes_sw !== undefined) updates.notes_sw = args.notes_sw;
        if (args.payment_terms !== undefined) updates.payment_terms = args.payment_terms;

        if (args.items) {
          const items: InvoiceItem[] = args.items.map((item: any) => ({
            id: generateId(),
            description: item.description,
            description_sw: item.description_sw || null,
            quantity: item.quantity,
            unit_price: item.unit_price,
            tax_rate: item.tax_rate || KENYA_VAT_RATE,
            vat_inclusive: item.vat_inclusive || false,
            category: item.category || 'other',
            total: calculateItemTotal({
              description: item.description,
              quantity: item.quantity,
              unit_price: item.unit_price,
              tax_rate: item.tax_rate || KENYA_VAT_RATE,
              vat_inclusive: item.vat_inclusive || false
            })
          }));
          
          const { subtotal, vat_amount, total_amount } = calculateInvoiceTotals(items);
          updates.items = items;
          updates.subtotal = subtotal;
          updates.vat_amount = vat_amount;
          updates.total_amount = total_amount;
        }

        const { data, error } = await supabase
          .from('invoices')
          .update(updates)
          .eq('id', args.invoice_id)
          .select()
          .single();

        if (error) throw error;
        return {
          content: [
            {
              type: "text",
              text: `Invoice updated successfully:\n${JSON.stringify(data, null, 2)}`
            }
          ]
        };
      }

      case "delete_invoice": {
        const { data, error } = await supabase
          .from('invoices')
          .delete()
          .eq('id', args.invoice_id)
          .select()
          .single();
        
        if (error) throw error;
        if (!data) throw new Error(`Invoice with ID ${args.invoice_id} not found`);
        
        return {
          content: [
            {
              type: "text",
              text: `Invoice ${data.invoice_number} deleted successfully`
            }
          ]
        };
      }

      case "generate_invoice_pdf": {
        const { invoice_id, language = 'en' } = args;
        
        const { data: invoice, error } = await supabase
          .from('invoices')
          .select('*')
          .eq('id', invoice_id)
          .single();
        
        if (error || !invoice) {
          throw new Error(`Invoice with ID ${invoice_id} not found`);
        }

        const pdfContent = generateInvoicePDF(invoice, language);

        return {
          content: [
            {
              type: "text",
              text: pdfContent
            }
          ]
        };
      }

      case "get_invoice_summary": {
        const { business_id, period = 'all', language = 'en' } = args;
        
        let query = supabase
          .from('invoices')
          .select('*')
          .eq('business_id', business_id);

        // Apply date filtering based on period
        if (period !== 'all') {
          const now = new Date();
          let startDate;
          
          switch (period) {
            case 'week':
              startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
              break;
            case 'month':
              startDate = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
              break;
            case 'quarter':
              startDate = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
              break;
            case 'year':
              startDate = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
              break;
          }
          
          if (startDate) {
            query = query.gte('created_at', startDate.toISOString());
          }
        }

        const { data: invoices, error } = await query;
        if (error) throw error;

        const summary = {
          period: period,
          total_invoices: invoices.length,
          total_amount: invoices.reduce((sum, inv) => sum + inv.total_amount, 0),
          paid_amount: invoices.filter(inv => inv.status === 'paid').reduce((sum, inv) => sum + inv.total_amount, 0),
          pending_amount: invoices.filter(inv => inv.status !== 'paid' && inv.status !== 'cancelled').reduce((sum, inv) => sum + (inv.total_amount - inv.amount_paid), 0),
          overdue_amount: invoices.filter(inv => inv.status === 'overdue').reduce((sum, inv) => sum + (inv.total_amount - inv.amount_paid), 0),
          vat_collected: invoices.filter(inv => inv.status === 'paid').reduce((sum, inv) => sum + inv.vat_amount, 0),
          by_status: {
            draft: invoices.filter(inv => inv.status === 'draft').length,
            sent: invoices.filter(inv => inv.status === 'sent').length,
            paid: invoices.filter(inv => inv.status === 'paid').length,
            overdue: invoices.filter(inv => inv.status === 'overdue').length,
            partially_paid: invoices.filter(inv => inv.status === 'partially_paid').length,
            cancelled: invoices.filter(inv => inv.status === 'cancelled').length
          },
          by_payment_method: {
            mpesa: invoices.filter(inv => inv.payment_method === 'mpesa').length,
            bank: invoices.filter(inv => inv.payment_method === 'bank').length,
            cash: invoices.filter(inv => inv.payment_method === 'cash').length,
            other: invoices.filter(inv => inv.payment_method === 'other').length
          }
        };

        const isSwahili = language === 'sw';
        const summaryText = isSwahili 
          ? `📊 Muhtasari wa Ankara (${period}):

Jumla ya Ankara: ${summary.total_invoices}
Kiasi cha Jumla: ${formatKES(summary.total_amount)}
Kilicholipwa: ${formatKES(summary.paid_amount)}
Kilichobaki: ${formatKES(summary.pending_amount)}
Kilichochelewa: ${formatKES(summary.overdue_amount)}
VAT Iliyokusanywa: ${formatKES(summary.vat_collected)}

Kwa Hali:
• Rasimu: ${summary.by_status.draft}
• Imetumwa: ${summary.by_status.sent}
• Imelipwa: ${summary.by_status.paid}
• Imechelewa: ${summary.by_status.overdue}
• Imelipwa Sehemu: ${summary.by_status.partially_paid}
• Imeghairiwa: ${summary.by_status.cancelled}`
          : `📊 Invoice Summary (${period}):

Total Invoices: ${summary.total_invoices}
Total Amount: ${formatKES(summary.total_amount)}
Paid Amount: ${formatKES(summary.paid_amount)}
Pending Amount: ${formatKES(summary.pending_amount)}
Overdue Amount: ${formatKES(summary.overdue_amount)}
VAT Collected: ${formatKES(summary.vat_collected)}

By Status:
• Draft: ${summary.by_status.draft}
• Sent: ${summary.by_status.sent}
• Paid: ${summary.by_status.paid}
• Overdue: ${summary.by_status.overdue}
• Partially Paid: ${summary.by_status.partially_paid}
• Cancelled: ${summary.by_status.cancelled}`;

        return {
          content: [
            {
              type: "text",
              text: summaryText
            }
          ]
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

    // Handle direct tool calls (for Edge Function architecture)
    if (body.tool && body.parameters) {
      const result = await handleTool(body.tool, body.parameters);
      
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

// Database Schema Requirements
/*
-- Enhanced tables for the Kenya-focused invoice system

-- Clients table
CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR NOT NULL,
  business_name_swahili VARCHAR,
  email VARCHAR NOT NULL,
  phone VARCHAR NOT NULL,
  address TEXT NOT NULL,
  kra_pin VARCHAR,
  preferred_language VARCHAR DEFAULT 'en' CHECK (preferred_language IN ('en', 'sw')),
  business_type VARCHAR DEFAULT 'other' CHECK (business_type IN ('retail', 'services', 'trading', 'manufacturing', 'other')),
  business_id UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(phone, business_id)
);

-- Invoices table
CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number VARCHAR NOT NULL,
  client_id UUID REFERENCES clients(id),
  client_name VARCHAR NOT NULL,
  client_email VARCHAR NOT NULL,
  client_phone VARCHAR,
  client_address TEXT NOT NULL,
  client_kra_pin VARCHAR,
  issue_date DATE NOT NULL,
  due_date DATE NOT NULL,
  items JSONB NOT NULL,
  subtotal DECIMAL(12,2) NOT NULL,
  vat_amount DECIMAL(12,2) NOT NULL,
  total_amount DECIMAL(12,2) NOT NULL,
  amount_paid DECIMAL(12,2) DEFAULT 0,
  status VARCHAR DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'partially_paid', 'cancelled')),
  payment_method VARCHAR CHECK (payment_method IN ('mpesa', 'bank', 'cash', 'other')),
  mpesa_code VARCHAR,
  language VARCHAR DEFAULT 'en' CHECK (language IN ('en', 'sw')),
  currency VARCHAR DEFAULT 'KES',
  template_type VARCHAR DEFAULT 'standard',
  notes TEXT,
  notes_sw TEXT,
  payment_terms TEXT,
  business_id UUID NOT NULL,
  reminder_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  sent_at TIMESTAMP WITH TIME ZONE,
  paid_at TIMESTAMP WITH TIME ZONE,
  last_reminder_at TIMESTAMP WITH TIME ZONE,
  UNIQUE(invoice_number, business_id)
);

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_clients_business_id ON clients(business_id);
CREATE INDEX IF NOT EXISTS idx_clients_phone ON clients(phone);
CREATE INDEX IF NOT EXISTS idx_invoices_business_id ON invoices(business_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_client_id ON invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_due_date ON invoices(due_date);
CREATE INDEX IF NOT EXISTS idx_invoices_created_at ON invoices(created_at);
*/
