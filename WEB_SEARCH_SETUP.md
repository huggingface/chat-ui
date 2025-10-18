# 🔧 Web Search API Setup Guide

## 🚀 Quick Start

### Step 1: Choose Your Search Provider

**Recommended Order (Best to Good):**
1. **Google Custom Search** - Most reliable, good results
2. **Bing Search API** - Microsoft's search, good alternative
3. **SerpAPI** - Easy setup, good for development
4. **DuckDuckGo** - Free, no API key required
5. **Brave Search** - Privacy-focused alternative
6. **You.com** - AI-powered search

### Step 2: Set Up Environment Variables

Create a `.env` file in your project root with at least one of these:

```bash
# Google Custom Search API (Recommended)
GOOGLE_SEARCH_API_KEY=your_google_api_key_here
GOOGLE_SEARCH_ENGINE_ID=your_search_engine_id_here

# Bing Search API
BING_SEARCH_API_KEY=your_bing_api_key_here

# SerpAPI (Good for development)
SERPAPI_API_KEY=your_serpapi_key_here

# Brave Search API
BRAVE_SEARCH_API_KEY=your_brave_api_key_here

# You.com Search API
YOUCOM_API_KEY=your_youcom_api_key_here
```

## 🔑 API Key Setup Instructions

### 1. Google Custom Search API (Recommended)

**Why:** Most reliable, excellent results, widely used

**Setup:**
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Enable the "Custom Search API"
4. Go to "Credentials" → "Create Credentials" → "API Key"
5. Copy your API key
6. Go to [Google Custom Search Engine](https://cse.google.com/)
7. Create a new search engine
8. Copy your Search Engine ID

**Cost:** 100 free queries/day, then $5 per 1000 queries

### 2. Bing Search API

**Why:** Microsoft's search, good alternative to Google

**Setup:**
1. Go to [Azure Portal](https://portal.azure.com/)
2. Create a "Cognitive Services" resource
3. Choose "Bing Search v7"
4. Get your API key from the resource
5. Add to your `.env` file

**Cost:** 1000 free queries/month, then $3 per 1000 queries

### 3. SerpAPI (Great for Development)

**Why:** Easy setup, handles rate limiting, good for testing

**Setup:**
1. Sign up at [serpapi.com](https://serpapi.com/)
2. Get your API key from the dashboard
3. Add to your `.env` file

**Cost:** 100 free queries/month, then $50/month for 5000 queries

### 4. DuckDuckGo (Free!)

**Why:** Completely free, no API key required, privacy-focused

**Setup:**
- No setup required! It's automatically enabled
- Limited results but good for basic searches

**Cost:** Free

### 5. Brave Search API

**Why:** Privacy-focused, independent search index

**Setup:**
1. Go to [Brave Search API](https://brave.com/search/api/)
2. Sign up for an account
3. Get your API key
4. Add to your `.env` file

**Cost:** 2000 free queries/month, then $3 per 1000 queries

### 6. You.com Search API

**Why:** AI-powered search, good for specific queries

**Setup:**
1. Go to [You.com Developer](https://you.com/developer)
2. Sign up for an account
3. Get your API key
4. Add to your `.env` file

**Cost:** 1000 free queries/month, then $20/month for 10000 queries

## 🧪 Testing Your Setup

### Test with Mock Data (No API Keys Required)

1. Start your development server
2. Send a message: `🌐 Using web search who is david parnas`
3. You should see mock results with citations

### Test with Real APIs

1. Set up at least one API key
2. Send the same message
3. You should see real search results with citations

## 📊 Rate Limiting & Monitoring

The system includes built-in rate limiting:

- **Per-minute limits:** Prevents API abuse
- **Daily limits:** Prevents quota exhaustion
- **Automatic fallback:** Tries next provider if one fails
- **Mock data fallback:** Works even if all APIs fail

### Monitor Your Usage

Check the console logs for:
```
Performing web search for: [query]
Trying Google Custom Search search...
Found 5 results with Google Custom Search
```

## 🔧 Configuration Options

### Customize Detection Patterns

Edit `src/lib/server/webSearch/patterns.ts`:

```typescript
const searchPatterns = [
  /🌐.*using web search/i,
  /web search/i,
  /search the web/i,
  /find information about/i,
  // Add your custom patterns
  /look up/i,
  /search for/i
];
```

### Adjust Rate Limits

Edit `src/lib/server/webSearch/config.ts`:

```typescript
providers: {
  google: {
    rateLimit: {
      requestsPerMinute: 10,  // Adjust as needed
      requestsPerDay: 100     // Adjust as needed
    }
  }
}
```

## 🚨 Troubleshooting

### Common Issues

1. **"No search providers configured"**
   - Check your `.env` file has at least one API key
   - Restart your development server

2. **"API rate limit exceeded"**
   - Wait a minute and try again
   - Consider upgrading your API plan
   - The system will try other providers automatically

3. **"All search providers failed"**
   - Check your internet connection
   - Verify API keys are correct
   - Check API quotas in your provider dashboard

4. **Citations not showing**
   - Ensure `sources` prop is passed to `MarkdownRenderer`
   - Check that the message contains `[1]`, `[2]` style references

### Debug Mode

Enable detailed logging by checking the console for:
- Search provider attempts
- Rate limit status
- API response details
- Fallback behavior

## 💡 Pro Tips

1. **Start with DuckDuckGo** - It's free and works immediately
2. **Add Google for production** - Best results and reliability
3. **Use SerpAPI for development** - Easy setup and good for testing
4. **Monitor your usage** - Set up alerts for API quotas
5. **Test with different queries** - Some providers work better for different topics

## 🎯 Success Criteria

Your setup is working when:
- ✅ Messages with `🌐 using web search` trigger searches
- ✅ Real search results are returned (not mock data)
- ✅ Citations appear as `(Article 1, Article 2)` in responses
- ✅ Citations are clickable and open in new tabs
- ✅ System falls back gracefully if APIs fail

## 📞 Need Help?

1. Check the console logs for error messages
2. Verify your API keys are correct
3. Test with mock data first
4. Check API quotas and rate limits
5. Review the detection patterns

The system is designed to be robust with multiple fallbacks, so it should work even if some APIs are unavailable!