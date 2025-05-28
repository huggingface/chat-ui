# Web Search

Chat UI features a powerful Web Search feature. A high level overview of how it works:

1. Generate an appropriate search query from the user prompt using the `TASK_MODEL`
2. Perform web search via an external provider (i.e. Serper) or via locally scrape Google results
3. Load each search result into playwright and scrape
4. Convert scraped HTML to Markdown tree with headings as parents
5. Create embeddings for each Markdown element
6. Find the embeddings closest to the user query using a vector similarity search (inner product)
7. Get the corresponding Markdown elements and their parent, up to 8000 characters
8. Supply the information as context to the model

<div class="flex justify-center">
<img class="block dark:hidden" src="https://huggingface.co/datasets/huggingface/documentation-images/resolve/main/chat-ui/websearch-light.png" height="auto"/>
<img class="hidden dark:block" src="https://huggingface.co/datasets/huggingface/documentation-images/resolve/main/chat-ui/websearch-dark.png" height="auto"/>
</div>

## Providers

Many providers are supported for the web search, or you can use locally scraped Google results.

### Local

For locally scraped Google results, put `USE_LOCAL_WEBSEARCH=true` in your `.env.local`. Please note that you may hit rate limits as we make no attempt to make the traffic look legitimate. To avoid this, you may choose a provider, such as Serper, used on the official instance.

### SearXNG

> SearXNG is a free internet metasearch engine which aggregates results from various search services and databases. Users are neither tracked nor profiled.

You may enable support via the `SEARXNG_QUERY_URL` where `<query>` will be replaced with the query keywords. Please see [the official documentation](https://docs.searxng.org/dev/search_api.html) for more information

Example: `https://searxng.yourdomain.com/search?q=<query>&engines=duckduckgo,google&format=json`

### Third Party

Many third party providers are supported as well. The official instance uses Serper.

```ini
YDC_API_KEY=docs.you.com api key here
SERPER_API_KEY=serper.dev api key here
SERPAPI_KEY=serpapi key here
SERPSTACK_API_KEY=serpstack api key here
SEARCHAPI_KEY=searchapi api key here
```

## Block/Allow List

You may block or allow specific websites from the web search results. When using an allow list, only the links in the allowlist will be used. For supported search engines, the links will be blocked from the results directly. Any URL in the results that **partially or fully matches** the entry will be filtered out.

```ini
WEBSEARCH_BLOCKLIST=`["youtube.com", "https://example.com/foo/bar"]`
WEBSEARCH_ALLOWLIST=`["stackoverflow.com"]`
```

## Disabling Javascript

By default, Playwright will execute all Javascript on the page. This can be intensive, requiring up to 6 cores for full performance, on some webpages. You may block scripts from running by settings `WEBSEARCH_JAVASCRIPT=false`. However, this will not block Javascript inlined in the HTML.
