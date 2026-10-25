import { WorkerEntrypoint } from "cloudflare:workers";

const endpoint = "https://music.apple.com/us";
const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' };

// Fallback only: used when the JWT cannot be decoded or has no usable exp.
const FALLBACK_MAX_AGE = 300;

// Cacheable entrypoint. Workers Cache runs in front of it, so the scrape below
// happens once per cache entry and concurrent misses are collapsed into one run.
export class TokenService extends WorkerEntrypoint {
	async fetch(): Promise<Response> {
		const token = await getBearerToken();

		if (!token) {
			return new Response("Could not obtain an Apple Music bearer token", {
				status: 502,
				// Never let a failure be stored and replayed.
				headers: { "Cache-Control": "no-store" },
			});
		}

		return new Response(token, {
			headers: {
				"Content-Type": "text/plain",
				"Cache-Control": `public, max-age=${maxAge(token)}`,
			},
		});
	}
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
		console.error("Error decoding bearer token exp:", err);
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
		console.error("Error fetching bearer token:", err);
	}
	return null;
}
