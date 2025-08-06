// Test your optimized queries
async function testOptimizedQueries() {
  const businessId = 'test_business_123';
  
  console.log('Testing optimized database queries...');
  
  // Test 1: Recent transactions
  const start1 = Date.now();
  const recent = await getRecentTransactions(businessId, 7);
  console.log(`Recent transactions (${recent.length} results): ${Date.now() - start1}ms`);
  
  // Test 2: Business income
  const start2 = Date.now();  
  const income = await getBusinessIncome(businessId, '2024-01-01', '2024-12-31');
  console.log(`Business income (${income.length} results): ${Date.now() - start2}ms`);
  
  // Test 3: Duplicate detection
  const start3 = Date.now();
  const duplicates = await findDuplicateTransactions(businessId, 24);
  console.log(`Duplicate detection (${duplicates.length} results): ${Date.now() - start3}ms`);
  
  // All queries should be < 50ms with proper indexes
  const totalTime = Date.now() - start1;
  console.log(`Total query time: ${totalTime}ms`);
  
  return totalTime < 200; // Should be very fast with indexes
}
