import { getAnalytics, getSearchEvents, getProviderPerformance, getAnalyticsForPeriod } from "./analytics";
import { getEnabledProviders } from "./config";

/**
 * Web Search Dashboard - Monitor and analyze search performance
 */
export class WebSearchDashboard {
	/**
	 * Get a comprehensive dashboard overview
	 */
	static getOverview() {
		const analytics = getAnalytics();
		const providerPerformance = getProviderPerformance();
		const recentEvents = getSearchEvents(10);
		const last24Hours = getAnalyticsForPeriod(24);
		
		return {
			summary: {
				totalSearches: analytics.totalSearches,
				successRate: analytics.totalSearches > 0 
					? ((analytics.successfulSearches / analytics.totalSearches) * 100).toFixed(1) + '%'
					: '0%',
				averageResponseTime: Math.round(analytics.averageResponseTime) + 'ms',
				lastSearch: analytics.lastSearch?.toISOString() || 'Never'
			},
			providers: Object.entries(providerPerformance).map(([name, stats]) => ({
				name,
				...stats,
				successRate: stats.successRate.toFixed(1) + '%',
				averageResponseTime: Math.round(stats.averageResponseTime) + 'ms',
				lastUsed: stats.lastUsed?.toISOString() || 'Never'
			})),
			recentActivity: recentEvents.map(event => ({
				timestamp: event.timestamp.toISOString(),
				query: event.query,
				provider: event.provider,
				success: event.success,
				responseTime: event.responseTime + 'ms',
				resultCount: event.resultCount,
				error: event.error
			})),
			last24Hours: {
				searches: last24Hours.totalSearches || 0,
				successRate: last24Hours.totalSearches > 0 
					? (((last24Hours.successfulSearches || 0) / last24Hours.totalSearches) * 100).toFixed(1) + '%'
					: '0%',
				averageResponseTime: Math.round(last24Hours.averageResponseTime || 0) + 'ms'
			},
			queryTypes: analytics.queryTypes,
			rateLimitHits: analytics.rateLimitHits
		};
	}
	
	/**
	 * Get provider health status
	 */
	static getProviderHealth() {
		const enabledProviders = getEnabledProviders();
		const providerPerformance = getProviderPerformance();
		
		return enabledProviders.map(provider => {
			const stats = providerPerformance[provider.name];
			const isHealthy = stats ? stats.successRate > 80 : false;
			const isActive = stats ? stats.totalSearches > 0 : false;
			
			return {
				name: provider.name,
				enabled: provider.enabled,
				healthy: isHealthy,
				active: isActive,
				successRate: stats?.successRate.toFixed(1) + '%' || 'N/A',
				totalSearches: stats?.totalSearches || 0,
				lastUsed: stats?.lastUsed?.toISOString() || 'Never',
				rateLimit: provider.rateLimit
			};
		});
	}
	
	/**
	 * Get search trends over time
	 */
	static getSearchTrends(hours: number = 24) {
		const events = getSearchEvents();
		const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
		const recentEvents = events.filter(event => event.timestamp >= cutoff);
		
		// Group by hour
		const hourlyData: Record<string, { searches: number; successes: number }> = {};
		
		recentEvents.forEach(event => {
			const hour = event.timestamp.toISOString().slice(0, 13) + ':00:00';
			if (!hourlyData[hour]) {
				hourlyData[hour] = { searches: 0, successes: 0 };
			}
			hourlyData[hour].searches++;
			if (event.success) {
				hourlyData[hour].successes++;
			}
		});
		
		return Object.entries(hourlyData).map(([hour, data]) => ({
			hour,
			searches: data.searches,
			successes: data.successes,
			successRate: data.searches > 0 ? ((data.successes / data.searches) * 100).toFixed(1) + '%' : '0%'
		}));
	}
	
	/**
	 * Get top queries
	 */
	static getTopQueries(limit: number = 10) {
		const events = getSearchEvents();
		const queryCounts: Record<string, number> = {};
		
		events.forEach(event => {
			queryCounts[event.query] = (queryCounts[event.query] || 0) + 1;
		});
		
		return Object.entries(queryCounts)
			.sort(([,a], [,b]) => b - a)
			.slice(0, limit)
			.map(([query, count]) => ({ query, count }));
	}
	
	/**
	 * Get error analysis
	 */
	static getErrorAnalysis() {
		const events = getSearchEvents();
		const errors: Record<string, number> = {};
		
		events.filter(event => !event.success && event.error).forEach(event => {
			const errorType = event.error?.includes('rate limit') ? 'Rate Limit' :
							 event.error?.includes('API key') ? 'API Key' :
							 event.error?.includes('network') ? 'Network' :
							 event.error?.includes('timeout') ? 'Timeout' : 'Other';
			errors[errorType] = (errors[errorType] || 0) + 1;
		});
		
		return Object.entries(errors).map(([errorType, count]) => ({
			errorType,
			count,
			percentage: events.length > 0 ? ((count / events.length) * 100).toFixed(1) + '%' : '0%'
		}));
	}
	
	/**
	 * Generate a health report
	 */
	static generateHealthReport() {
		const overview = this.getOverview();
		const providerHealth = this.getProviderHealth();
		const errorAnalysis = this.getErrorAnalysis();
		
		const report = {
			generatedAt: new Date().toISOString(),
			overallHealth: this.calculateOverallHealth(overview, providerHealth),
			recommendations: this.generateRecommendations(overview, providerHealth, errorAnalysis),
			overview,
			providerHealth,
			errorAnalysis
		};
		
		return report;
	}
	
	/**
	 * Calculate overall health score (0-100)
	 */
	private static calculateOverallHealth(overview: any, providerHealth: any[]): number {
		const successRate = parseFloat(overview.summary.successRate);
		const activeProviders = providerHealth.filter(p => p.active).length;
		const totalProviders = providerHealth.length;
		const healthyProviders = providerHealth.filter(p => p.healthy).length;
		
		const healthScore = (
			(successRate * 0.4) + // 40% weight on success rate
			((activeProviders / totalProviders) * 100 * 0.3) + // 30% weight on active providers
			((healthyProviders / totalProviders) * 100 * 0.3) // 30% weight on healthy providers
		);
		
		return Math.round(healthScore);
	}
	
	/**
	 * Generate recommendations based on analytics
	 */
	private static generateRecommendations(overview: any, providerHealth: any[], errorAnalysis: any[]): string[] {
		const recommendations: string[] = [];
		
		// Check success rate
		const successRate = parseFloat(overview.summary.successRate);
		if (successRate < 80) {
			recommendations.push("⚠️ Low success rate detected. Consider adding more search providers or checking API configurations.");
		}
		
		// Check response time
		const avgResponseTime = parseInt(overview.summary.averageResponseTime);
		if (avgResponseTime > 5000) {
			recommendations.push("🐌 Slow response times detected. Consider optimizing search providers or adding caching.");
		}
		
		// Check provider health
		const unhealthyProviders = providerHealth.filter(p => !p.healthy && p.active);
		if (unhealthyProviders.length > 0) {
			recommendations.push(`🔧 ${unhealthyProviders.length} provider(s) showing poor performance: ${unhealthyProviders.map(p => p.name).join(', ')}`);
		}
		
		// Check rate limits
		const rateLimitHits = Object.values(overview.rateLimitHits).reduce((sum: number, count: any) => sum + count, 0);
		if (rateLimitHits > 0) {
			recommendations.push("📊 Rate limits being hit. Consider upgrading API plans or adding more providers.");
		}
		
		// Check error patterns
		const rateLimitErrors = errorAnalysis.find(e => e.errorType === 'Rate Limit');
		if (rateLimitErrors && rateLimitErrors.count > 0) {
			recommendations.push("🚫 Rate limit errors detected. Consider implementing better rate limiting or adding more providers.");
		}
		
		if (recommendations.length === 0) {
			recommendations.push("✅ All systems operating normally!");
		}
		
		return recommendations;
	}
}

