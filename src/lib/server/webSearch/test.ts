import { performWebSearch, detectWebSearchRequest } from "./webSearchService";
import { defaultWebSearchConfig } from "./config";
import { testPatterns } from "./patterns";
import { WebSearchDashboard } from "./dashboard";
import { resetAnalytics } from "./analytics";

/**
 * Test script for web search functionality
 * Run with: npx tsx src/lib/server/webSearch/test.ts
 */

async function testWebSearch() {
	console.log("🧪 Testing Enhanced Web Search Implementation");
	console.log("==============================================");

	// Reset analytics for clean test
	resetAnalytics();

	// Test 1: Enhanced detection patterns
	console.log("\n1. Testing enhanced detection patterns:");
	const testMessages = [
		"🌐 Using web search who is david parnas",
		"web search latest news about AI",
		"search the web for information about climate change",
		"find information about quantum computing",
		"what is machine learning",
		"who is alan turing",
		"tell me about blockchain",
		"explain quantum computing",
		"regular message without search",
		"🌐 using web search what is machine learning"
	];

	testPatterns(testMessages);

	// Test 2: Web search execution with analytics
	console.log("\n2. Testing web search execution with analytics:");
	const testQueries = [
		"who is david parnas",
		"latest AI news",
		"climate change facts",
		"quantum computing basics",
		"machine learning algorithms"
	];

	for (const query of testQueries) {
		console.log(`\n  Testing query: "${query}"`);
		try {
			const startTime = Date.now();
			const result = await performWebSearch(query);
			const duration = Date.now() - startTime;
			
			console.log(`    ✅ Success in ${duration}ms`);
			console.log(`    📊 Found ${result.results.length} results`);
			console.log(`    🔗 First result: ${result.results[0]?.title || "None"}`);
			console.log(`    🌐 First link: ${result.results[0]?.link || "None"}`);
		} catch (error) {
			console.log(`    ❌ Failed: ${error}`);
		}
	}

	// Test 3: Configuration and providers
	console.log("\n3. Testing configuration and providers:");
	console.log(`  📋 Available providers: ${Object.keys(defaultWebSearchConfig.providers).length}`);
	console.log(`  🔧 Max results: ${defaultWebSearchConfig.maxResults}`);
	console.log(`  ⏱️  Timeout: ${defaultWebSearchConfig.timeout}ms`);
	console.log(`  💾 Cache enabled: ${defaultWebSearchConfig.cacheEnabled}`);

	// Test 4: Rate limiting and monitoring
	console.log("\n4. Testing rate limiting and monitoring:");
	console.log("  📈 Rate limits configured:");
	Object.entries(defaultWebSearchConfig.providers).forEach(([name, config]) => {
		if (config.enabled) {
			console.log(`    ${name}: ${config.rateLimit?.requestsPerMinute || "unlimited"}/min, ${config.rateLimit?.requestsPerDay || "unlimited"}/day`);
		}
	});

	// Test 5: Analytics and dashboard
	console.log("\n5. Testing analytics and dashboard:");
	const dashboard = WebSearchDashboard.getOverview();
	console.log(`  📊 Total searches: ${dashboard.summary.totalSearches}`);
	console.log(`  ✅ Success rate: ${dashboard.summary.successRate}`);
	console.log(`  ⏱️  Average response time: ${dashboard.summary.averageResponseTime}`);
	console.log(`  🕒 Last search: ${dashboard.summary.lastSearch}`);

	// Test 6: Provider health
	console.log("\n6. Testing provider health:");
	const providerHealth = WebSearchDashboard.getProviderHealth();
	providerHealth.forEach(provider => {
		console.log(`  ${provider.name}: ${provider.healthy ? '✅' : '❌'} ${provider.successRate} (${provider.totalSearches} searches)`);
	});

	// Test 7: Search trends
	console.log("\n7. Testing search trends:");
	const trends = WebSearchDashboard.getSearchTrends(1); // Last hour
	console.log(`  📈 Searches in last hour: ${trends.length > 0 ? trends.reduce((sum, t) => sum + t.searches, 0) : 0}`);

	// Test 8: Top queries
	console.log("\n8. Testing top queries:");
	const topQueries = WebSearchDashboard.getTopQueries(5);
	topQueries.forEach((query, index) => {
		console.log(`  ${index + 1}. "${query.query}" (${query.count} times)`);
	});

	// Test 9: Error analysis
	console.log("\n9. Testing error analysis:");
	const errorAnalysis = WebSearchDashboard.getErrorAnalysis();
	if (errorAnalysis.length > 0) {
		errorAnalysis.forEach(error => {
			console.log(`  ${error.errorType}: ${error.count} (${error.percentage})`);
		});
	} else {
		console.log("  ✅ No errors detected");
	}

	// Test 10: Health report
	console.log("\n10. Generating health report:");
	const healthReport = WebSearchDashboard.generateHealthReport();
	console.log(`  🏥 Overall health: ${healthReport.overallHealth}/100`);
	console.log("  💡 Recommendations:");
	healthReport.recommendations.forEach(rec => {
		console.log(`    ${rec}`);
	});

	console.log("\n✅ Enhanced web search test completed!");
	console.log("\n📝 Next steps:");
	console.log("  1. Set up at least one API key in your .env file");
	console.log("  2. Test with real queries in your chat interface");
	console.log("  3. Monitor the dashboard for search analytics");
	console.log("  4. Customize detection patterns if needed");
	console.log("  5. Set up monitoring and alerting for production");
}

// Run the test if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
	testWebSearch().catch(console.error);
}

export { testWebSearch };
