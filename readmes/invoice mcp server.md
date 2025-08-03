Core Functionality
Client Management:

Create, list, and retrieve clients
Store client details (name, email, address, phone, tax ID)

Invoice Management:

Create invoices with multiple line items
List invoices with filtering (by status or client)
Update invoice details and status
Delete invoices
Generate PDF-formatted invoice text
Get invoice summaries and statistics

Key Features:

Automatic invoice numbering (INV-1000, INV-1001, etc.)
Automatic tax and total calculations
Invoice status tracking (draft, sent, paid, overdue, cancelled)
Comprehensive validation using Zod schemas
In-memory storage (easily replaceable with database)

Available Tools

create_client - Add new clients
list_clients - View all clients
get_client - Get specific client details
create_invoice - Create new invoices with items
list_invoices - List invoices with optional filtering
get_invoice - Get specific invoice details
update_invoice - Modify existing invoices
delete_invoice - Remove invoices
generate_invoice_pdf - Create formatted invoice output
get_invoice_summary - Get business analytics
Runtime & Imports:

Changed from Node.js to Deno runtime
Using Deno standard library for HTTP server
Importing Supabase client from ESM

2. Database Integration:

Replaced in-memory storage with Supabase database
All operations now use Supabase client
Proper error handling for database operations

3. HTTP Server Structure:

Uses Deno's serve() function instead of stdio transport
Handles HTTP requests/responses with JSON
Added CORS headers for web compatibility

4. Database Schema Requirements:
You'll need to create these tables in your Supabase database:
sql-- Clients table
CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  address TEXT NOT NULL,
  phone TEXT,
  tax_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Invoices table
CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number TEXT NOT NULL UNIQUE,
  client_id UUID REFERENCES clients(id),
  client_name TEXT NOT NULL,
  client_email TEXT NOT NULL,
  client_address TEXT NOT NULL,
  issue_date DATE NOT NULL,
  due_date DATE NOT NULL,
  items JSONB NOT NULL,
  subtotal DECIMAL(10,2) NOT NULL,
  tax_amount DECIMAL(10,2) NOT NULL,
  total_amount DECIMAL(10,2) NOT NULL,
  status TEXT CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'cancelled')) DEFAULT 'draft',
  notes TEXT,
  payment_terms TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
Deployment Steps:

Create the Edge Function:

bashsupabase functions new finji-invoice-mcp

Deploy the function:

bashsupabase functions deploy finji-invoice-mcp

Set environment variables (if needed):

bashsupabase secrets set SUPABASE_URL=your_url
supabase secrets set SUPABASE_ANON_KEY=your_key
New Kenya-Specific Features
1. Natural Language Invoice Creation
typescript// "20 bags rice at 3000, 5 services at 15000"
create_quick_invoice

Parses Swahili and English descriptions
Auto-creates clients from phone numbers
Perfect for your WhatsApp "send photo, get invoice" workflow

2. WhatsApp Integration Ready
typescriptsend_invoice_whatsapp  // Send PDF via WhatsApp
send_payment_reminder  // Automated reminders

Instant PDF sharing on WhatsApp
Multilingual reminders
Perfect for your target market

3. M-Pesa Payment Integration
typescriptmark_invoice_paid_from_mpesa

Auto-matches payments to invoices
Handles partial payments
Records M-Pesa transaction codes

4. Kenya Compliance Features

KRA PIN validation (A123456789B format)
16% VAT calculations with inclusive/exclusive options
Kenyan phone number formatting (+254...)
KES currency formatting with proper localization

5. Multilingual Support (Swahili/English)

All PDFs in both languages
Swahili business templates
Localized field names and messages

6. Business Templates

Retail Shop template (market traders)
Service Provider template
Trading Business template
Each with appropriate defaults

7. Advanced Analytics
typescriptget_invoice_analytics
get_overdue_invoices

Payment efficiency tracking
VAT collection reports
Overdue invoice management
Multi-language reporting

🎯 Perfect Alignment with Your GTM Strategy
✅ Urban Market Traders: Quick invoice from "20 bags at 3000"
✅ WhatsApp Native: Send invoices instantly via WhatsApp
✅ M-Pesa Integration: Auto-payment reconciliation
✅ Tax Compliance: KRA PIN validation, VAT calculations
✅ Multilingual: Full Swahili support
✅ Mobile-First: Phone number-based client creation
🏗️ Database Schema Included
The enhanced schema supports:

Multilingual client/invoice data
Kenya-specific fields (KRA PIN, phone validation)
Payment method tracking
Reminder management
Business type categorization

🚀 Ready for Your MVP Launch
This enhanced invoice MCP is now perfectly positioned for your Phase 1 launch targeting 100 paying customers. It handles everything from your "Tuma picha ya M-Pesa statement, Finji itatengeneza invoice yako" value proposition to advanced analytics for growing businesses.
The system will seamlessly integrate with your M-Pesa MCP and main Finji agent, creating the complete solution your Kenyan SMEs need!
