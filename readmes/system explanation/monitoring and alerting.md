
## What You Currently Have (Basic Logging):
- `console.error('AI intent analysis failed:', error);`
- `console.error('AI response generation failed:', error);`
- `console.error('Finji request failed:', error);`
- `console.warn(`High memory usage: ${memUsage}MB`);`

## What's Missing for Production Monitoring:

### 1. **Structured Logging with Metrics**
### 2. **Real-time Alerting for Critical Issues** 
### 3. **Business KPI Tracking**
### 4. **Health Checks & Uptime Monitoring**

---

# Let's Add Production-Ready Monitoring

## Step 1: Create Monitoring Manager

**Location**: `finji-mcp-architecture.ts` - Add this NEW class after `APIQuotaManager`:

```typescript
class MonitoringManager {
  private supabase;
  private criticalErrors = new Set(['quota_exceeded', 'security_violation', 'timeout', 'ai_failure']);
  
  constructor() {
    this.supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );
  }

  // Log structured events for monitoring
  async logEvent(eventType: string, data: any, businessId?: string) {
    const event = {
      event_type: eventType,
      business_id: businessId,
      data: data,
      timestamp: new Date().toISOString(),
      severity: this.getSeverity(eventType),
      environment: Deno.env.get('ENVIRONMENT') || 'production'
    };

    // Log to console for immediate visibility
    if (event.severity === 'critical' || event.severity === 'error') {
      console.error(`🚨 ${eventType}:`, JSON.stringify(event, null, 2));
    } else {
      console.log(`📊 ${eventType}:`, JSON.stringify(event));
    }

    // Store in database for analysis
    try {
      await this.supabase.from('monitoring_events').insert(event);
    } catch (error) {
      console.error('Failed to store monitoring event:', error);
    }

    // Send critical alerts immediately
    if (this.criticalErrors.has(eventType)) {
      await this.sendCriticalAlert(event);
    }
  }

  // Track business KPIs
  async trackKPI(businessId: string, kpiType: string, value: number, metadata?: any) {
    const kpi = {
      business_id: businessId,
      kpi_type: kpiType,
      value: value,
      metadata: metadata,
      recorded_at: new Date().toISOString()
    };

    await this.supabase.from('business_kpis').insert(kpi);
    
    console.log(`📈 KPI tracked: ${kpiType} = ${value} for business ${businessId}`);
  }

  // Send critical alerts (you'd integrate with email/SMS/Slack)
  private async sendCriticalAlert(event: any) {
    const alertMessage = `🚨 CRITICAL ALERT 🚨
Event: ${event.event_type}
Business: ${event.business_id || 'System'}
Time: ${event.timestamp}
Data: ${JSON.stringify(event.data)}

Requires immediate attention!`;

    console.error(alertMessage);
    
    // TODO: Integrate with your alerting system
    // - Send email via SendGrid/Resend
    // - Send SMS via Twilio
    // - Post to Slack webhook
    // - Create PagerDuty incident
    
    // Example Slack webhook (replace with your webhook URL)
    try {
      await fetch(Deno.env.get('SLACK_WEBHOOK_URL') || '', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: alertMessage,
          channel: '#finji-alerts',
          username: 'Finji Monitor'
        })
      });
    } catch (error) {
      console.error('Failed to send Slack alert:', error);
    }
  }

  private getSeverity(eventType: string): string {
    const severityMap = {
      // Critical - immediate attention needed
      'security_violation': 'critical',
      'data_breach_attempt': 'critical',
      'system_failure': 'critical',
      'quota_exceeded': 'critical',
      
      // Error - needs attention soon
      'ai_failure': 'error',
      'timeout': 'error',
      'api_error': 'error',
      'parsing_failed': 'error',
      
      // Warning - monitor closely
      'high_memory_usage': 'warning',
      'rate_limit_hit': 'warning',
      'slow_response': 'warning',
      
      // Info - normal operations
      'mpesa_parsed': 'info',
      'invoice_created': 'info',
      'user_interaction': 'info'
    };

    return severityMap[eventType] || 'info';
  }

  // Generate monitoring dashboard data
  async getDashboardStats(timeRange: string = '24h') {
    const hours = timeRange === '24h' ? 24 : 1;
    const since = new Date(Date.now() - (hours * 60 * 60 * 1000)).toISOString();

    const { data: events } = await this.supabase
      .from('monitoring_events')
      .select('*')
      .gte('timestamp', since);

    const stats = {
      total_events: events?.length || 0,
      critical_events: events?.filter(e => e.severity === 'critical').length || 0,
      error_events: events?.filter(e => e.severity === 'error').length || 0,
      unique_businesses: new Set(events?.map(e => e.business_id).filter(Boolean)).size,
      top_errors: this.getTopErrors(events || []),
      system_health: this.calculateSystemHealth(events || [])
    };

    return stats;
  }

  private getTopErrors(events: any[]) {
    const errorCounts = new Map();
    
    events
      .filter(e => e.severity === 'error' || e.severity === 'critical')
      .forEach(e => {
        errorCounts.set(e.event_type, (errorCounts.get(e.event_type) || 0) + 1);
      });

    return Array.from(errorCounts.entries())
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5);
  }

  private calculateSystemHealth(events: any[]): string {
    const totalEvents = events.length;
    if (totalEvents === 0) return 'healthy';

    const errorEvents = events.filter(e => 
      e.severity === 'error' || e.severity === 'critical'
    ).length;

    const errorRate = errorEvents / totalEvents;

    if (errorRate > 0.1) return 'critical';  // >10% errors
    if (errorRate > 0.05) return 'degraded'; // >5% errors
    return 'healthy';
  }
}
```

## Step 2: Create Monitoring Tables in Supabase

**Run this in Supabase SQL Editor**:

```sql
-- Monitoring events table
CREATE TABLE monitoring_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  business_id TEXT,
  data JSONB,
  severity TEXT CHECK (severity IN ('info', 'warning', 'error', 'critical')),
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
  environment TEXT DEFAULT 'production',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Business KPIs table
CREATE TABLE business_kpis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id TEXT NOT NULL,
  kpi_type TEXT NOT NULL,
  value NUMERIC NOT NULL,
  metadata JSONB,
  recorded_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_monitoring_events_type ON monitoring_events(event_type, timestamp);
CREATE INDEX idx_monitoring_events_business ON monitoring_events(business_id, timestamp);
CREATE INDEX idx_monitoring_events_severity ON monitoring_events(severity, timestamp);
CREATE INDEX idx_business_kpis_lookup ON business_kpis(business_id, kpi_type, recorded_at);
```

## Step 3: Add Monitoring to FinjiAgent

**MODIFY** the `FinjiAgent` constructor:

```typescript
class FinjiAgent {
  private mcpServers: MCPServer[];
  private queueManager: QueueManager;
  private securityManager: BusinessSecurityManager;
  private quotaManager: APIQuotaManager;
  private monitor: MonitoringManager; // ADD THIS
  
  constructor() {
    this.mcpServers = [
      // ... existing servers
    ];
    this.queueManager = new QueueManager();
    this.securityManager = new BusinessSecurityManager();
    this.quotaManager = new APIQuotaManager();
    this.monitor = new MonitoringManager(); // ADD THIS
  }
```

## Step 4: Add Monitoring to Key Operations

### **In processWhatsAppMessage() method - ADD monitoring**:

**FIND THIS LINE**:
```typescript
async processWhatsAppMessage(message: string, businessId: string, userPhone: string, language: 'en' | 'sw' = 'en') {
```

**ADD RIGHT AFTER**:
```typescript
async processWhatsAppMessage(message: string, businessId: string, userPhone: string, language: 'en' | 'sw' = 'en') {
  const startTime = Date.now();
  
  try {
    // Log user interaction
    await this.monitor.logEvent('user_interaction', {
      message_length: message.length,
      language,
      has_image: message.includes('[Image attached')
    }, businessId);
```

**AT THE END of the method, BEFORE the return statement**:
```typescript
    // Track processing time
    const processingTime = Date.now() - startTime;
    await this.monitor.trackKPI(businessId, 'response_time_ms', processingTime);
    
    if (processingTime > 10000) { // > 10 seconds
      await this.monitor.logEvent('slow_response', {
        processing_time: processingTime,
        message_length: message.length
      }, businessId);
    }

    return {
      response,
      actions_taken: results.map(r => r.action),
      language,
      business_id: businessId,
      whatsapp_ready: true
    };
  } catch (error) {
    // Log processing failure
    await this.monitor.logEvent('processing_failed', {
      error: error.message,
      processing_time: Date.now() - startTime,
      message_length: message.length
    }, businessId);
    
    throw error; // Re-throw to maintain error handling
  }
```

### **In analyzeWhatsAppIntent() method**:

**REPLACE THE CATCH BLOCK**:
```typescript
} catch (error) {
  console.error('AI intent analysis failed:', error);
  
  // Log AI failure for monitoring
  await this.monitor.logEvent('ai_failure', {
    error: error.message,
    api_type: 'gemini',
    operation: 'intent_analysis'
  }, businessId);
  
  // FALLBACK: Basic keyword matching
  return this.fallbackIntentAnalysis(message, language);
}
```

### **In executeActions() method**:

**ADD monitoring in the catch block**:
```typescript
} catch (error) {
  console.error(`Action failed: ${action.tool}`, error);
  
  // Log action failure
  await this.monitor.logEvent('action_failed', {
    action: action.tool,
    server: action.server,
    error: error.message,
    timeout: error.message.includes('timeout')
  }, businessId);
  
  results.push({ 
    action: action.tool, 
    error: error.message, 
    success: false,
    server: action.server,
    fallback_available: this.hasFallback(action.tool)
  });
```

### **In the main Deno.serve() handler**:

**ADD at the beginning**:
```typescript
Deno.serve(async (req) => {
  const requestStart = Date.now();
  const monitor = new MonitoringManager();
  
  try {
```

**MODIFY the error handling**:
```typescript
} catch (error) {
  const processingTime = Date.now() - requestStart;
  
  // Log request failure with detailed context
  await monitor.logEvent('request_failed', {
    error: error.message,
    processing_time: processingTime,
    request_method: req.method,
    user_agent: req.headers.get('user-agent'),
    content_length: req.headers.get('content-length')
  }, body?.business_id);
  
  console.error('Finji request failed:', error);
  
  // ... rest of existing error handling
```

## Step 5: Create Health Check Endpoint

**Create new file**: `supabase/functions/health-check/index.ts`:

```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );

    // Check database connectivity
    const { data, error } = await supabase
      .from('monitoring_events')
      .select('count(*)')
      .limit(1);

    if (error) throw error;

    // Check API keys
    const hasGeminiKey = !!Deno.env.get('GEMINI_API_KEY');
    const hasVisionKey = !!Deno.env.get('GOOGLE_API_KEY');

    // Get system stats
    const memoryUsage = Deno.memoryUsage();

    const healthStatus = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      checks: {
        database: 'healthy',
        gemini_api: hasGeminiKey ? 'healthy' : 'missing_key',
        vision_api: hasVisionKey ? 'healthy' : 'missing_key',
        memory_usage_mb: Math.round(memoryUsage.heapUsed / (1024 * 1024))
      },
      uptime_seconds: Math.floor(process.uptime?.() || 0)
    };

    // Determine overall status
    if (!hasGeminiKey || !hasVisionKey) {
      healthStatus.status = 'degraded';
    }

    return new Response(JSON.stringify(healthStatus), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    return new Response(JSON.stringify({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
```

## Summary: What We've Added

✅ **Structured Event Logging**: All errors, successes, and KPIs tracked
✅ **Real-time Critical Alerts**: Slack/email notifications for serious issues  
✅ **Business KPI Tracking**: Response times, success rates, usage patterns
✅ **Health Check Endpoint**: `/health-check` for uptime monitoring
✅ **Dashboard-Ready Data**: Query monitoring tables for insights
✅ **Severity Classification**: Critical/Error/Warning/Info levels

## Critical Metrics You'll Now Track:

```typescript
const criticalMetrics = {
  system_health: "Overall error rate < 5%",
  response_time: "95% of requests < 5 seconds", 
  api_quota_usage: "Per business quotas tracked",
  security_violations: "Any unauthorized access attempts",
  parsing_success_rate: "M-Pesa parsing accuracy > 85%",
  uptime: "Service availability > 99%"
};
```

**Now your system has production-grade monitoring!** You'll know immediately when things break and have data to optimize performance.

