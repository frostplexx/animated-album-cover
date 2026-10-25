import { logger } from "./log";
import type { CoverCache } from "./cache";

const endpoint = "https://music.apple.com/us";
const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' };

// Fallback only: used when the JWT cannot be decoded or has no usable exp.
const FALLBACK_MAX_AGE = 300;
// Consider a token stale slightly early so it cannot expire mid-request.
const EXPIRY_MARGIN = 60;

const TOKEN_CACHE_KEY = "token";

interface CachedToken {
	token: string;
	expiresAt: number;
}

// Warm invocations skip the scrape entirely; the table entry covers cold starts
// and other instances.
let memo: CachedToken | undefined;

export async function getToken(cache: CoverCache | undefined): Promise<string | null> {
	const now = epoch();

	if (memo && memo.expiresAt - EXPIRY_MARGIN > now) {
		return memo.token;
	}

	const cached = await cache?.get<CachedToken>(TOKEN_CACHE_KEY);

	if (cached?.token && cached.expiresAt - EXPIRY_MARGIN > now) {
		memo = cached;
		return cached.token;
	}

	const token = await getBearerToken();

	if (!token) {
		return null;
	}

	const ttl = maxAge(token);
	memo = { token, expiresAt: now + ttl };
	await cache?.set(TOKEN_CACHE_KEY, memo, ttl);

	return token;
}

// Seconds until the JWT's exp claim, so the cache entry dies with the token.
export function maxAge(token: string): number {
	try {
		const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
		const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
		const { exp } = JSON.parse(atob(padded));

		if (typeof exp === "number") {
			const remaining = Math.floor(exp - Date.now() / 1000);
			if (remaining > 0) {
				return remaining;
			}
		}
	} catch (err) {
		logger.error("Error decoding bearer token exp:", err);
	}
	return FALLBACK_MAX_AGE;
}

async function getBearerToken(): Promise<string | null> {
	try {
		const response = await fetch(endpoint, { headers });
		const html = await response.text();

		const jsPaths = [...html.matchAll(/(\/assets\/[^"]+\.js)/g)]
			.map(m => m[1])
			.filter(p => ['index', 'web-client', 'apple-music'].some(x => p.includes(x)));

		for (const jsPath of [...new Set(jsPaths)]) {
			const jsRes = await fetch(`https://music.apple.com${jsPath}`, { headers });
			const jsText = await jsRes.text();

			const tokenMatch = jsText.match(/["'](eyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+)["']/);
			if (tokenMatch) {
				return tokenMatch[1];
			}
		}
	} catch (err) {
		logger.error("Error fetching bearer token:", err);
	}
	return null;
}

function epoch(): number {
	return Math.floor(Date.now() / 1000);
}
