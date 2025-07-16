/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import puppeteer from '@cloudflare/puppeteer';
import { decompressFromEncodedURIComponent } from 'lz-string';

const MERMAID_CDN = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js';

declare global {
	interface Window {
		mermaid: any;
	}
}

interface Env {
	BROWSER: Fetcher;
	CACHE_STATS: KVNamespace;
}

// Cache statistics tracking
interface CacheStats {
	hits: number;
	misses: number;
	lastReset: string;
}

async function getCacheStats(env: Env): Promise<CacheStats> {
	const stats = await env.CACHE_STATS.get('stats');
	if (!stats) {
		return { hits: 0, misses: 0, lastReset: new Date().toISOString() };
	}
	return JSON.parse(stats);
}

async function incrementCacheHit(env: Env): Promise<void> {
	const stats = await getCacheStats(env);
	stats.hits++;
	await env.CACHE_STATS.put('stats', JSON.stringify(stats));
}

async function incrementCacheMiss(env: Env): Promise<void> {
	const stats = await getCacheStats(env);
	stats.misses++;
	await env.CACHE_STATS.put('stats', JSON.stringify(stats));
}

async function resetCacheStats(env: Env): Promise<void> {
	const stats: CacheStats = { hits: 0, misses: 0, lastReset: new Date().toISOString() };
	await env.CACHE_STATS.put('stats', JSON.stringify(stats));
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		
		// Add endpoint to view cache statistics
		if (url.pathname === '/cache-stats') {
			const stats = await getCacheStats(env);
			const total = stats.hits + stats.misses;
			const hitRate = total > 0 ? ((stats.hits / total) * 100).toFixed(2) : '0.00';
			
			return new Response(JSON.stringify({
				...stats,
				total,
				hitRate: `${hitRate}%`,
				efficiency: total > 0 ? `${stats.hits}/${total} requests served from cache` : 'No requests yet'
			}, null, 2), {
				headers: { 'Content-Type': 'application/json' }
			});
		}

		// Add endpoint to reset cache statistics
		if (url.pathname === '/cache-stats/reset') {
			await resetCacheStats(env);
			return new Response(JSON.stringify({ message: 'Cache statistics reset' }), {
				headers: { 'Content-Type': 'application/json' }
			});
		}

		// Add endpoint to list cache entries (for debugging)
		if (url.pathname === '/cache-entries') {
			const cache = caches.default;
			const keys = await cache.keys();
			const entries = keys.map(req => ({
				url: req.url,
				method: req.method
			}));
			
			return new Response(JSON.stringify({
				count: entries.length,
				entries: entries.slice(0, 50) // Limit to first 50 entries
			}, null, 2), {
				headers: { 'Content-Type': 'application/json' }
			});
		}

		if (url.pathname !== '/svg') {
			return new Response('Not found', { status: 404 });
		}

		const compressed = url.searchParams.get('mermaid');
		if (!compressed) {
			return new Response('Missing mermaid parameter', { status: 400 });
		}

		const mermaidString = decompressFromEncodedURIComponent(compressed);
		if (!mermaidString) {
			return new Response('Failed to decompress mermaid parameter', { status: 400 });
		}

		const cache = caches.default;
		let response = await cache.match(request.url);
		
		if (response) {
			// Cache hit - increment counter and log
			await incrementCacheHit(env);
			console.log(`Cache HIT for URL: ${request.url}`);
			return response;
		}

		// Cache miss - increment counter and log
		await incrementCacheMiss(env);
		console.log(`Cache MISS for URL: ${request.url}`);
		console.log(`Mermaid diagram: ${mermaidString.substring(0, 100)}${mermaidString.length > 100 ? '...' : ''}`);

		const theme = url.searchParams.get('theme') === 'dark' ? 'dark' : 'default';

		let svg: string | undefined;
		try {
			const browser = await puppeteer.launch(env.BROWSER);
			const page = await browser.newPage();
			await page.goto('about:blank');
			await page.addScriptTag({ url: MERMAID_CDN });
			svg = await page.evaluate(
				async (mermaidString, theme) => {
					// @ts-ignore
					await window.mermaid.initialize({ startOnLoad: false, theme });
					// @ts-ignore
					const { svg } = await window.mermaid.render(`ms-${Math.random().toString(16).slice(2)}`, mermaidString);
					return svg;
				},
				mermaidString,
				theme
			);
			await browser.close();
		} catch (err: any) {
			console.error('Error during browser rendering:', err && (err.stack || err.message || err));
			return new Response('Internal error', { status: 500 });
		}

		if (!svg || !svg.startsWith('<svg')) {
			return new Response('Failed to render SVG', { status: 500 });
		}

		response = new Response(svg, {
			headers: {
				'Content-Type': 'image/svg+xml',
				'Cache-Control': 'public, max-age=31536000',
			},
		});
		
		// Store in cache and log
		ctx.waitUntil(cache.put(request, response.clone()));
		console.log(`Cached response for URL: ${request.url}`);
		
		return response;
	},
} satisfies ExportedHandler<Env>;
