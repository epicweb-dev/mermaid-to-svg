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
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
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
			console.log(`CACHE HIT - ${url.searchParams.get('theme') || 'default'} theme`);
			return response;
		}

		console.log(`CACHE MISS - ${url.searchParams.get('theme') || 'default'} theme, diagram: ${mermaidString.substring(0, 50)}${mermaidString.length > 50 ? '...' : ''}`);

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
		ctx.waitUntil(cache.put(request, response.clone()));
		return response;
	},
} satisfies ExportedHandler<Env>;
