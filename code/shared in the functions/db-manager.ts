import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

class DatabaseManager {
  private static instance: DatabaseManager;
  private client: SupabaseClient;
  private isInitialized = false;

  private constructor() {
    // Create single optimized client
    this.client = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        db: {
          schema: 'public',
        },
        auth: {
          persistSession: false,  // Don't persist sessions in serverless
          autoRefreshToken: false, // No need in short-lived functions
        },
        realtime: {
          params: {
            eventsPerSecond: 10,  // Limit realtime events
          },
        },
        global: {
          headers: {
            'x-client-info': 'finji-mcp/1.0',
          },
        },
      }
    );
    this.isInitialized = true;
  }

  public static getInstance(): DatabaseManager {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager();
    }
    return DatabaseManager.instance;
  }

  public getClient(): SupabaseClient {
    if (!this.isInitialized) {
      throw new Error('Database manager not initialized');
    }
    return this.client;
  }

  // Business-specific client with RLS context
  public async getBusinessClient(businessId: string): Promise<SupabaseClient> {
    if (!businessId) {
      throw new Error('Business ID required');
    }

    // Set business context for Row Level Security
    await this.client.rpc('set_config', {
      setting_name: 'app.current_business_id',
      setting_value: businessId,
      is_local: true
    });

    return this.client;
  }

  // Execute query with automatic retry and timeout
  public async executeQuery<T>(
    operation: (client: SupabaseClient) => Promise<T>,
    businessId?: string,
    timeoutMs: number = 10000
  ): Promise<T> {
    const client = businessId 
      ? await this.getBusinessClient(businessId)
      : this.getClient();

    // Add timeout wrapper
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Database query timeout')), timeoutMs);
    });

    try {
      const result = await Promise.race([
        operation(client),
        timeoutPromise
      ]);

      return result;
    } catch (error) {
      console.error('Database query failed:', error);
      
      // Retry once for transient errors
      if (this.isRetryableError(error)) {
        console.log('Retrying database query...');
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1s delay
        return await operation(client);
      }
      
      throw error;
    }
  }

  private isRetryableError(error: any): boolean {
    const retryableErrors = [
      'ECONNRESET',
      'ECONNREFUSED', 
      'ETIMEDOUT',
      'connection closed',
      'server temporarily unavailable'
    ];

    const errorMessage = error?.message?.toLowerCase() || '';
    return retryableErrors.some(msg => errorMessage.includes(msg));
  }

  // Batch operations for better performance
  public async batchInsert<T>(
    table: string, 
    records: T[], 
    businessId: string,
    batchSize: number = 100
  ) {
    const client = await this.getBusinessClient(businessId);
    const results = [];

    // Process in batches to avoid overwhelming database
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      
      const { data, error } = await client
        .from(table)
        .insert(batch)
        .select();

      if (error) {
        console.error(`Batch insert failed for batch ${i}-${i + batchSize}:`, error);
        throw error;
      }

      if (data) {
        results.push(...data);
      }

      // Small delay between batches to be nice to the database
      if (i + batchSize < records.length) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }

    return results;
  }

  // Health check for monitoring
  public async healthCheck(): Promise<{ healthy: boolean; latency: number }> {
    const start = Date.now();
    
    try {
      const { error } = await this.client
        .from('transactions')
        .select('count()', { count: 'exact', head: true })
        .limit(1);

      const latency = Date.now() - start;

      return {
        healthy: !error,
        latency
      };
    } catch (error) {
      return {
        healthy: false,
        latency: Date.now() - start
      };
    }
  }
}

export const dbManager = DatabaseManager.getInstance();
