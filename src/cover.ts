import { WorkerEntrypoint } from "cloudflare:workers";
import {
	AlbumAttributes,
	AlbumCover,
	AlbumResource,
	AppleMusicSearchResponse,
	CoverSearchData,
	SongResource,
} from "./types";

export const DEFAULT_STOREFRONT = "us";
// Album artwork changes rarely; a week keeps repeat lookups off Apple entirely.
const CACHE_TTL = 60 * 60 * 24 * 7;

// How many search hits to score. More candidates give the ranking in rankAlbums()
// room to find an edition that actually has animated artwork.
const MAX_CANDIDATES = 10;

const AMP_API = "https://amp-api.music.apple.com/v1/catalog";

// Cacheable entrypoint. Workers Cache runs in front of it, so repeat lookups of the
// same album/artist/storefront are served without touching Apple, and concurrent
// misses are collapsed into one run. The token is fetched here (not passed in) so
// the cache key stays a plain URL.
export class CoverService extends WorkerEntrypoint {
	async fetch(request: Request): Promise<Response> {
		// Workers Caching (cache.enabled) only runs in production, so this explicit
		// layer is what gives `wrangler dev` the same hits. It sits before the token
		// fetch, so a hit costs one cache lookup and nothing else.
		const cache = caches.default;
		const cached = await cache.match(request);

		if (cached) {
			return cached;
		}

		const params = new URL(request.url).searchParams;

		const data: CoverSearchData = {
			album: params.get("album") ?? "",
			title: params.get("title") ?? "",
			artist: params.get("artist") ?? "",
			year: params.get("year") ?? "",
		};
		const storefront = params.get("storefront") || DEFAULT_STOREFRONT;

		const tokenResponse = await this.ctx.exports.TokenService.fetch(new Request("https://token.internal/"));

		if (!tokenResponse.ok) {
			return json({ error: await tokenResponse.text() }, 502, { "Cache-Control": "no-store" });
		}

		const cover = await fetchCover(data, await tokenResponse.text(), storefront);

		if (!cover) {
			// Never let a miss be stored and replayed.
			return new Response("Cover not found", { status: 404, headers: { "Cache-Control": "no-store" } });
		}

		const response = json(cover, 200, { "Cache-Control": `public, max-age=${CACHE_TTL}` });
		await cache.put(request, response.clone());

		return response;
	}
}

export async function fetchCover(
	data: CoverSearchData,
	token: string,
	storefront: string = DEFAULT_STOREFRONT,
): Promise<AlbumCover | null> {
	let albumName = data.album.trim();

	// Only the track is known: ask the songs index which album it belongs to.
	if (!albumName) {
		if (!data.title.trim()) {
			console.error("Cover lookup needs an album or a title");
			return null;
		}

		albumName = (await resolveAlbumName(data, token, storefront)) ?? "";

		if (!albumName) {
			console.error("No song match for:", data.title, data.artist);
			return null;
		}
	}

	const candidates = await searchAlbums(albumName, data.artist, token, storefront);
	const ranked = rankAlbums(candidates, albumName, data.artist, data.year);

	// Prefer an edition that actually has a loop, even if it ranked lower (the
	// canonical edition of some albums ships without animated artwork).
	const match = ranked.find((candidate) => candidate.attributes?.editorialVideo) ?? ranked[0];
	const attributes = match?.attributes;

	if (!match || !attributes) {
		console.error("No matching album for:", albumName, data.artist, data.year);
		return null;
	}
	// The animated artwork loop comes as a square/tall pair; the motionDetail* videos
	// are detail-page heroes and are dropped here.
	const square = attributes.editorialVideo?.motionSquareVideo1x1;
	const tall = attributes.editorialVideo?.motionTallVideo3x4;

	if (!square?.video && !tall?.video) {
		console.error("No animated cover loop for album:", attributes.name, match.id);
		return null;
	}

	console.log("Matched album:", match.id, attributes.name, `(${attributes.artistName})`);

	return {
		album: attributes.name,
		artist: attributes.artistName,
		artwork: attributes.artwork.url,
		animatedCover: {
			square: square?.video,
			tall: tall?.video,
			previewFrame: square?.previewFrame?.url,
		},
	};
}

// Track title -> album name. The songs index is relevance-ranked, and its albumName
// is the canonical album the recording belongs to, so no album guessing is needed.
async function resolveAlbumName(
	data: CoverSearchData,
	token: string,
	storefront: string,
): Promise<string | undefined> {
	const params = new URLSearchParams({
		// Year and ISRC are deliberately left out: they skew relevance badly.
		term: `${data.title} ${data.artist}`.trim(),
		types: "songs",
		limit: String(MAX_CANDIDATES),
	});

	const result = await search(params, token, storefront);
	return pickAlbumName(result?.results?.songs?.data ?? [], data);
}

async function searchAlbums(
	albumName: string,
	artist: string,
	token: string,
	storefront: string,
): Promise<AlbumResource[]> {
	const params = new URLSearchParams({
		term: `${albumName} ${artist}`.trim(),
		types: "albums",
		limit: String(MAX_CANDIDATES),
		extend: "editorialVideo",
	});

	const result = await search(params, token, storefront);
	return result?.results?.albums?.data ?? [];
}

async function search(
	params: URLSearchParams,
	token: string,
	storefront: string,
): Promise<AppleMusicSearchResponse | null> {
	const apiUrl = `${AMP_API}/${storefront}/search?${params}`;

	const result = await fetch(apiUrl, {
		method: "GET",
		headers: {
			"Authorization": `Bearer ${token}`,
			'Origin': 'https://music.apple.com',
			'User-Agent': 'Mozilla/5.0'
		},
	})

	if (!result.ok) {
		console.error("Apple Music API request failed:", result.status, result.statusText, apiUrl);
		return null;
	}

	const resData: AppleMusicSearchResponse = await result.json();

	if ("errors" in resData) {
		console.error("Apple Music API error:", resData.errors);
		return null;
	}

	return resData;
}

// Best matching song's album name. Exact titles beat medleys and live cuts.
function pickAlbumName(songs: SongResource[], data: CoverSearchData): string | undefined {
	const wantArtist = normalize(data.artist);
	let best: { album: string; score: number } | undefined;

	for (const song of songs) {
		const attributes = song.attributes;
		if (!attributes?.albumName) continue;

		const artist = normalize(attributes.artistName);
		if (wantArtist && !artistMatches(artist, wantArtist)) continue;

		const nameScore = scoreName(attributes.name, data.title);
		if (!nameScore) continue;

		const score = nameScore + (artist === wantArtist ? 4 : 1);

		if (!best || score > best.score) {
			best = { album: attributes.albumName, score };
		}
	}

	return best?.album;
}

// The search API ranks the canonical album first, but not every edition carries
// animated artwork (the original "Dark Side of the Moon" has none, the 50th
// anniversary does), so the caller picks the best-ranked candidate with a loop.
function rankAlbums(
	candidates: AlbumResource[],
	albumName: string,
	artist: string,
	year: string,
): AlbumResource[] {
	const scored: { candidate: AlbumResource; score: number }[] = [];

	for (const candidate of candidates) {
		if (!candidate.attributes) continue;

		const score = scoreAlbum(candidate.attributes, albumName, artist, year);
		if (score > 0) {
			scored.push({ candidate, score });
		}
	}

	scored.sort((a, b) => b.score - a.score);

	return scored.map((entry) => entry.candidate);
}

function scoreAlbum(
	attributes: AlbumAttributes,
	albumName: string,
	artist: string,
	year: string,
): number {
	const nameScore = scoreName(attributes.name, albumName);
	if (!nameScore) return 0;

	const wantArtist = normalize(artist);
	const albumArtist = normalize(attributes.artistName);

	// A different artist is a hard no, unless the caller did not supply one.
	if (wantArtist && !artistMatches(albumArtist, wantArtist)) return 0;

	let score = nameScore + (albumArtist === wantArtist ? 4 : 1);

	// Only a tiebreaker: editions of the same album often share the original date.
	if (year && attributes.releaseDate.startsWith(year)) score += 2;

	return score;
}

function artistMatches(artist: string, wantArtist: string): boolean {
	return artist === wantArtist || artist.includes(wantArtist) || wantArtist.includes(artist);
}

// 0 = unrelated, 4 = identical, 3 = deluxe/anniversary/live suffix,
// 2 = substring, everything else = number of shared words.
function scoreName(name: string, want: string): number {
	const have = normalize(name);
	const wanted = normalize(want);

	if (!have || !wanted) return 0;
	if (have === wanted) return 4;
	if (have.startsWith(`${wanted} `) || wanted.startsWith(`${have} `)) return 3;
	if (have.includes(wanted) || wanted.includes(have)) return 2;

	const wantedWords = new Set(wanted.split(" "));
	return have.split(" ").filter((word) => wantedWords.has(word)).length;
}

function normalize(value: string): string {
	return value
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
}

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json", ...headers },
	});
}
