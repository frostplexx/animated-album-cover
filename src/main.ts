import { createCache } from "./cache";
import { DEFAULT_STOREFRONT, fetchCover } from "./cover";
import { getToken } from "./token";
import type { AlbumCover, AlbumCoverResponse, CoverSearchData } from "./types";

// Album artwork changes rarely; a week keeps repeat lookups out of Apple entirely.
const CACHE_TTL_SECONDS = 60 * 60 * 24 * 7;

const CORS_HEADERS: Record<string, string> = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type",
	"Access-Control-Max-Age": "86400",
};

const NO_STORE: Record<string, string> = { ...CORS_HEADERS, "Cache-Control": "no-store" };

export default async ({ req, res, log }: AppwriteContext) => {
	// The TIDAL client runs on https://desktop.tidal.com, so every response needs CORS.
	if (req.method === "OPTIONS") {
		return res.send("", 204, CORS_HEADERS);
	}

	const storefront = (param(req, "storefront") || DEFAULT_STOREFRONT).toLowerCase();

	if (!/^[a-z]{2}$/.test(storefront)) {
		return res.json({ error: "Invalid storefront" }, 400, CORS_HEADERS);
	}

	const data: CoverSearchData = {
		album: param(req, "album").trim(),
		title: param(req, "title").trim(),
		artist: param(req, "artist").trim(),
		year: param(req, "year").trim(),
	};

	// The ISRC is caller-supplied and never used for the lookup, so it stays out of
	// the cache key and is attached to every response instead.
	const isrc = param(req, "isrc");
	const cache = createCache(req.headers["x-appwrite-key"]);
	const cacheKey = keyFor(data, storefront);

	const cached = await cache?.get<AlbumCover>(cacheKey);

	if (cached) {
		log(`Cache hit: ${describe(data)}`);
		return coverResponse(res, cached, isrc);
	}

	const token = await getToken(cache);

	if (!token) {
		return res.json({ error: "Could not obtain an Apple Music bearer token" }, 502, NO_STORE);
	}

	log(`Cache miss: ${describe(data)}`);
	const cover = await fetchCover(data, token, storefront);

	if (!cover) {
		// A track with no animated artwork stays a 404 on every lookup; the client
		// memoizes it, so this is one failed lookup per track per session.
		return res.send("Cover not found", 404, NO_STORE);
	}

	await cache?.set(cacheKey, cover, CACHE_TTL_SECONDS);

	return coverResponse(res, cover, isrc);
};

function coverResponse(res: AppwriteResponse, cover: AlbumCover, isrc: string) {
	const body: AlbumCoverResponse = { ...cover, isrc };

	return res.json(body, 200, { ...CORS_HEADERS, "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}` });
}

// Repeated query params arrive as arrays; the lookup only ever uses one value.
function param(req: AppwriteRequest, name: string): string {
	const value = req.query[name];

	if (Array.isArray(value)) {
		return value[0] ?? "";
	}

	return value ?? "";
}

// Lowercased and trimmed so trivially different requests share one cache row.
function keyFor(data: CoverSearchData, storefront: string): string {
	return [
		storefront,
		data.album.trim().toLowerCase(),
		data.title.trim().toLowerCase(),
		data.artist.trim().toLowerCase(),
		data.year.trim(),
	].join("\u0000");
}

// The cache key uses NUL separators, which must not reach the logs.
function describe(data: CoverSearchData): string {
	return [data.album || data.title || "(empty)", data.artist].filter(Boolean).join(" / ");
}
