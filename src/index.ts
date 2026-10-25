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

import { DEFAULT_STOREFRONT } from "./cover";
import { AlbumCover, AlbumCoverResponse } from "./types";

export { TokenService } from "./token";
export { CoverService } from "./cover";

export default {
	async fetch(request: Request, env, ctx): Promise<Response> {
		// The TIDAL client runs on https://desktop.tidal.com, so every response
		// (including 400/404/502 and the CoverService pass-through) needs CORS.
		return withCors(await route(request, ctx));
	},
} satisfies ExportedHandler<Env>;

async function route(request: Request, ctx: ExecutionContext): Promise<Response> {
	if (request.method === "OPTIONS") {
		// No custom request headers are used, so this is only for safety.
		return new Response(null, { status: 204 });
	}

	// Extract Album, Title, Artist, Year, ISRC and storefront from the request URL query params
	const params = new URL(request.url).searchParams;

	const storefront = (params.get("storefront") || DEFAULT_STOREFRONT).toLowerCase();

	if (!/^[a-z]{2}$/.test(storefront)) {
		return json({ error: "Invalid storefront" }, 400);
	}

	// Loopback fetch through the cacheable CoverService entrypoint: on a hit the
	// Apple search in src/cover.ts is skipped entirely. The values are lowercased
	// so trivially different requests share one cache entry, and the ISRC is left
	// out of the URL so every track of an album shares that entry.
	const coverUrl = new URL("https://cover.internal/");
	coverUrl.searchParams.set("album", (params.get("album") || "").trim().toLowerCase());
	coverUrl.searchParams.set("title", (params.get("title") || "").trim().toLowerCase());
	coverUrl.searchParams.set("artist", (params.get("artist") || "").trim().toLowerCase());
	coverUrl.searchParams.set("year", params.get("year") || "");
	coverUrl.searchParams.set("storefront", storefront);

	let coverResponse: Response;
	try {
		coverResponse = await ctx.exports.CoverService.fetch(new Request(coverUrl));
	} catch (err) {
		console.error("CoverService failed:", err);
		return json({ error: (err as Error).message }, 502);
	}

	if (!coverResponse.ok) {
		return coverResponse;
	}

	// The ISRC is caller-supplied and never used for the lookup, so it is attached
	// here instead of being part of the cached payload.
	const cover: AlbumCoverResponse = {
		...(await coverResponse.json() as AlbumCover),
		isrc: params.get("isrc") || "",
	};

	return json(cover, 200, coverResponse.headers.get("Cache-Control"));
}

const CORS_HEADERS: Record<string, string> = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type",
	"Access-Control-Max-Age": "86400",
};

function withCors(response: Response): Response {
	const headers = new Headers(response.headers);

	for (const [name, value] of Object.entries(CORS_HEADERS)) {
		headers.set(name, value);
	}

	// A new Response, so the headers also land on pass-through responses.
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

function json(body: unknown, status: number, cacheControl?: string | null): Response {
	const headers: Record<string, string> = { "Content-Type": "application/json" };

	if (cacheControl) {
		headers["Cache-Control"] = cacheControl;
	}

	return new Response(JSON.stringify(body), { status, headers });
}
