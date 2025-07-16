# Cache Monitoring for Mermaid-to-SVG Worker

This document describes the cache monitoring features added to track cache performance and debug potential issues.

## Features Added

### 1. Cache Hit/Miss Tracking
- **Cache Hits**: Logged when a request is served from cache
- **Cache Misses**: Logged when a request requires browser rendering
- Statistics are persisted in Cloudflare KV storage

### 2. Console Logging
All cache operations are now logged to the console:
- `Cache HIT for URL: <url>` - When serving from cache
- `Cache MISS for URL: <url>` - When cache miss occurs
- `Mermaid diagram: <first 100 chars>...` - Shows what diagram was missed
- `Cached response for URL: <url>` - When storing new response in cache

### 3. New Endpoints

#### `/cache-stats`
Returns detailed cache statistics:
```json
{
  "hits": 45,
  "misses": 12,
  "lastReset": "2024-01-15T10:30:00.000Z",
  "total": 57,
  "hitRate": "78.95%",
  "efficiency": "45/57 requests served from cache"
}
```

#### `/cache-stats/reset`
Resets cache statistics to zero:
```json
{
  "message": "Cache statistics reset"
}
```

#### `/cache-entries`
Lists current cache entries (limited to first 50):
```json
{
  "count": 23,
  "entries": [
    {
      "url": "https://your-worker.workers.dev/svg?mermaid=...",
      "method": "GET"
    }
  ]
}
```

## Setup Requirements

### 1. Create KV Namespace
Before deploying, create the KV namespace:

```bash
# Create production namespace
wrangler kv:namespace create "CACHE_STATS"

# Create preview namespace for development
wrangler kv:namespace create "CACHE_STATS" --preview
```

### 2. Update wrangler.jsonc
Replace the placeholder IDs in `wrangler.jsonc` with the actual namespace IDs returned from the commands above:

```jsonc
"kv_namespaces": [
  {
    "binding": "CACHE_STATS",
    "id": "your-actual-namespace-id",
    "preview_id": "your-actual-preview-id"
  }
]
```

## Usage

### Monitor Cache Performance
```bash
# Check current cache statistics
curl https://your-worker.workers.dev/cache-stats

# Reset statistics
curl https://your-worker.workers.dev/cache-stats/reset

# View cache entries
curl https://your-worker.workers.dev/cache-entries
```

### View Logs
Monitor the worker logs to see real-time cache hits/misses:
```bash
wrangler tail
```

## Troubleshooting

### High Cache Miss Rate
If you're seeing more cache misses than expected:

1. **Check URL consistency**: Ensure the same mermaid diagram generates the same URL
2. **Verify cache headers**: The response includes `Cache-Control: public, max-age=31536000`
3. **Monitor cache entries**: Use `/cache-entries` to see what's actually cached
4. **Check logs**: Look for patterns in cache miss logs

### Expected Cache Behavior
- **Cache Key**: Full request URL (including query parameters)
- **Cache Duration**: 1 year (`max-age=31536000`)
- **Cache Scope**: Global across all users
- **Cache Storage**: Cloudflare's edge cache

## Performance Impact

The monitoring features have minimal performance impact:
- Cache statistics are updated asynchronously
- KV writes are non-blocking
- Console logging is lightweight
- Statistics endpoints are separate from main SVG generation

## Next Steps

Consider implementing:
- Cache warming for common diagrams
- Cache size monitoring
- Geographic cache distribution analysis
- Automated cache performance alerts