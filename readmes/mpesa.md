Here’s a step-by-step breakdown of the M-Pesa MCP Server script, showing how each part fits into the bigger picture. The script is a Supabase Edge Function designed to process, analyze, and reconcile M-Pesa transaction data for Kenyan businesses, using both AI and traditional programmatic methods.

---

### 1. **Imports and Type Definitions**
- **Imports:** Loads Supabase client and type definitions for Edge runtime.
- **Interfaces:** Defines the shape of a transaction (`MpesaTransaction`), business profile (`BusinessProfile`), and available tools (`MCPTool`). These help keep data structured and consistent.

**Big Picture:** These set up the expected data format for all processing and storage. It makes the code easier to maintain and extend.

---

### 2. **MpesaMCPServer Class**
This is the core engine. It wraps all logic and tool handlers.

#### **Constructor & Rate Limiting**
- Instantiates Supabase client using environment variables.
- Implements rate limiting per tool, preventing abuse.

**Big Picture:** Controls access and ensures fair usage for all users.

---

### 3. **Tool Definitions (`tools` property)**
Lists all supported operations:
- `parse_mpesa_statement`
- `categorize_transactions`
- `detect_anomalies`
- `get_transaction_insights`
- `reconcile_with_books`

Each tool has a name, description, and required parameters.

**Big Picture:** This makes the server modular and extensible. You can easily add new features as new “tools”.

---

### 4. **Main Handler (`call` method)**
Receives tool name and parameters, routes request to the relevant method.
- Checks rate limits
- Executes the tool logic
- Handles errors and returns standardized results

**Big Picture:** Centralizes all business logic for handling requests, simplifying debugging and extension.

---

### 5. **Tool Implementations**
Each tool is a method. Here’s the breakdown:

#### **A. Parsing M-Pesa Statements**
- Handles both text and images (using OCR if needed).
- Extracts transactions using Gemini AI if available, else uses fallback regex patterns for 2025 M-Pesa formats.
- Stores transactions in Supabase.
- Returns parsed transaction data, total, and confidence.

**Big Picture:** Automates data extraction from statements, making it easy for businesses to digitalize their records.

#### **B. Fallback Extraction (`enhancedFallbackExtraction`)**
- Uses regex to pull out transaction details when AI is unavailable.
- Handles all major transaction types (received, sent, paybill, buy goods, withdrawal, airtime).

**Big Picture:** Ensures robustness, so transactions can still be parsed without AI.

#### **C. Categorization**
- Uses business profile and enhanced category lists for 2025.
- Predicts category (income, expense, etc.) using heuristics.
- Stores categorized data and updates ML patterns for smarter predictions.

**Big Picture:** Helps businesses analyze spending and income automatically, supporting bookkeeping, reporting, and compliance.

#### **D. Anomaly Detection**
- Checks for unusual amounts, times, duplicates, fraud patterns, rapid transactions, etc.
- Assigns risk scores and recommendations.
- Returns a sorted list of flagged anomalies.

**Big Picture:** Protects businesses against fraud, mistakes, or suspicious activity.

#### **E. Transaction Insights**
- Computes business intelligence metrics like revenue, expenses, trends.
- Supports time-based analytics (day, week, month, quarter).
- Returns summaries, averages, peaks, and growth trends.

**Big Picture:** Empowers businesses with actionable insights, guiding strategic decisions.

#### **F. Reconciliation**
- Matches transactions against business book entries for a specified period.
- Identifies matched/unmatched items.
- Returns reconciliation summary and statistics.

**Big Picture:** Aids accountants and business owners in ensuring their digital records match their official books.

---

### 6. **Helper Methods**
- **Image Processing:** OCR for WhatsApp images/screenshots.
- **AI Calls:** Handles Gemini API requests and retries.
- **Transaction Validation, Cleaning, Formatting:** Standardizes dates, phone numbers, counterparty names.
- **Database Operations:** Storing transactions, fetching business profiles, learning patterns, etc.

**Big Picture:** These ensure accuracy, reliability, and consistency in all data handling.

---

### 7. **Supabase Edge Function Handler**
- Handles HTTP requests.
- Sets up CORS headers.
- Parses incoming JSON, calls the selected tool, and returns the result.
- Handles errors cleanly.

**Big Picture:** This is the entry point for all API calls—integrates the server with other systems (front-end, other APIs).

---

## **How All Parts Fit Together**

- **API Layer:** Accepts requests for different tools.
- **Processing Engine:** Cleans, parses, analyzes, and stores transaction data using AI and regex.
- **Business Intelligence:** Categorizes transactions, detects anomalies, and generates insights.
- **Reconciliation:** Ensures business records match transactions.
- **Extensibility:** New tools, formats, and checks can be added easily.

**In summary:**  
This script automates the full lifecycle of M-Pesa financial data for businesses—data entry, analysis, fraud detection, and reconciliation—using modern AI and robust fallback logic. Each part is modular, making the server powerful and adaptable for future financial and compliance needs.

If you want to learn about a specific function or how a particular tool works, let me know which part you’d like to go deeper on!
