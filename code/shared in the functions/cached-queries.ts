import { dbManager } from './db-manager.ts';
import { cacheManager } from './cache-manager.ts';

export class CachedQueries {
  
  // Cache business profile for 30 minutes
  static async getBusinessProfile(businessId: string) {
    return await cacheManager.cached(
      'business_profile',
      businessId,
      async () => {
        return await dbManager.executeQuery(async (client) => {
          const { data, error } = await client
            .from('business_profiles')
            .select('*')
            .eq('id', businessId)
            .single();

          if (error) {
            // Return default profile if not found
            return {
              id: businessId,
              name: 'Business User',
              industry: 'general',
              average_transaction_size: 1000,
              peak_hours: ['09:00-17:00'],
              common_counterparties: [],
              suspicious_patterns: []
            };
          }

          return data;
        }, businessId);
      },
      30 * 60 * 1000 // 30 minutes
    );
  }

  // Cache recent transactions for 2 minutes
  static async getRecentTransactions(businessId: string, days: number = 7) {
    return await cacheManager.cached(
      `recent_transactions_${days}d`,
      businessId,
      async () => {
        return await dbManager.executeQuery(async (client) => {
          const since = new Date(Date.now() - (days * 24 * 60 * 60 * 1000)).toISOString().split('T')[0];

          const { data, error } = await client
            .from('transactions')
            .select('*')
            .eq('business_id', businessId)
            .gte('date', since)
            .order('date', { ascending: false })
            .limit(100);

          if (error) throw error;
          return data || [];
        }, businessId);
      },
      2 * 60 * 1000 // 2 minutes
    );
  }

  // Cache business context for 10 minutes
  static async getBusinessContext(businessId: string, contextType: string) {
    return await cacheManager.cached(
      `business_context_${contextType}`,
      businessId,
      async () => {
        return await dbManager.executeQuery(async (client) => {
          const { data, error } = await client
            .from('business_memory')
            .select('*')
            .eq('business_id', businessId)
            .eq('preference_type', contextType)
            .order('created_at', { ascending: false })
            .limit(10);

          if (error) throw error;
          return data || [];
        }, businessId);
      },
      10 * 60 * 1000 // 10 minutes
    );
  }

  // Clear cache when data changes
  static invalidateBusinessCache(businessId: string) {
    cacheManager.clearBusiness(businessId);
  }
}
