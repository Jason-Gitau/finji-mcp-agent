interface CacheEntry<T> {
  data: T;
  expiry: number;
  hits: number;
}

class CacheManager {
  private static instance: CacheManager;
  private cache: Map<string, CacheEntry<any>> = new Map();
  private maxSize = 1000; // Max cache entries
  private defaultTTL = 5 * 60 * 1000; // 5 minutes

  private constructor() {
    // Clean expired entries every 2 minutes
    setInterval(() => this.cleanup(), 2 * 60 * 1000);
  }

  public static getInstance(): CacheManager {
    if (!CacheManager.instance) {
      CacheManager.instance = new CacheManager();
    }
    return CacheManager.instance;
  }

  // Get from cache with automatic expiry check
  public get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return null;
    }

    // Check if expired
    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      return null;
    }

    // Increment hit counter
    entry.hits++;
    return entry.data;
  }

  // Set cache with TTL
  public set<T>(key: string, data: T, ttlMs: number = this.defaultTTL): void {
    // Remove oldest entries if cache is full
    if (this.cache.size >= this.maxSize) {
      this.evictOldest();
    }

    this.cache.set(key, {
      data,
      expiry: Date.now() + ttlMs,
      hits: 0
    });
  }

  // Cache with automatic key generation for business queries
  public async cached<T>(
    keyPrefix: string,
    businessId: string,
    operation: () => Promise<T>,
    ttlMs: number = this.defaultTTL
  ): Promise<T> {
    const key = `${keyPrefix}:${businessId}`;
    
    // Try to get from cache first
    const cached = this.get<T>(key);
    if (cached !== null) {
      console.log(`Cache HIT: ${key}`);
      return cached;
    }

    // Execute operation and cache result
    console.log(`Cache MISS: ${key}`);
    const result = await operation();
    this.set(key, result, ttlMs);
    
    return result;
  }

  // Clear cache for specific business (e.g., when data changes)
  public clearBusiness(businessId: string): void {
    const keysToDelete = [];
    
    for (const [key] of this.cache) {
      if (key.includes(`:${businessId}`) || key.endsWith(businessId)) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach(key => this.cache.delete(key));
    console.log(`Cleared ${keysToDelete.length} cache entries for business ${businessId}`);
  }

  // Get cache statistics for monitoring
  public getStats() {
    const entries = Array.from(this.cache.values());
    const expired = entries.filter(e => Date.now() > e.expiry).length;
    
    return {
      totalEntries: this.cache.size,
      expiredEntries: expired,
      hitRate: entries.length > 0 
        ? entries.reduce((sum, e) => sum + e.hits, 0) / entries.length 
        : 0,
      memoryUsageMB: this.estimateMemoryUsage()
    };
  }

  private evictOldest(): void {
    // Find entry with lowest hits and oldest expiry
    let oldestKey = '';
    let lowestScore = Infinity;

    for (const [key, entry] of this.cache) {
      // Score = hits / age (lower is worse)
      const age = Date.now() - (entry.expiry - this.defaultTTL);
      const score = entry.hits / Math.max(age, 1);
      
      if (score < lowestScore) {
        lowestScore = score;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }

  private cleanup(): void {
    const now = Date.now();
    const expiredKeys = [];

    for (const [key, entry] of this.cache) {
      if (now > entry.expiry) {
        expiredKeys.push(key);
      }
    }

    expiredKeys.forEach(key => this.cache.delete(key));
    
    if (expiredKeys.length > 0) {
      console.log(`Cleaned up ${expiredKeys.length} expired cache entries`);
    }
  }

  private estimateMemoryUsage(): number {
    // Rough estimate of memory usage in MB
    const entries = Array.from(this.cache.values());
    const avgEntrySize = 1024; // Assume 1KB per entry average
    return (entries.length * avgEntrySize) / (1024 * 1024);
  }
}

export const cacheManager = CacheManager.getInstance();
