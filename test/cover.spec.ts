import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchCover } from "../src/cover";

const artwork = { url: "https://art/{w}x{h}.jpg", width: 1448, height: 1448 };

function album(overrides: Record<string, unknown> = {}, attributes: Record<string, unknown> = {}) {
	return {
		id: "1161539183",
		type: "albums",
		href: "/v1/catalog/us/albums/1161539183",
		attributes: {
			name: "American Idiot",
			artistName: "Green Day",
			releaseDate: "2004-09-21",
			artwork,
			editorialVideo: {
				motionSquareVideo1x1: { video: "https://video/square.m3u8", previewFrame: { url: "https://frame/{w}x{h}.jpg" } },
				motionTallVideo3x4: { video: "https://video/tall.m3u8" },
			},
			...attributes,
		},
		...overrides,
	};
}

function song(name: string, albumName: string, artistName = "Green Day") {
	return { id: "207192732", type: "songs", href: "/songs/207192732", attributes: { name, albumName, artistName } };
}

// Routes on the `types` query param, which is the only thing distinguishing the
// songs search from the albums search. `albums` may be keyed by term so a failing
// first lookup and a succeeding retry can be simulated.
function stubApi(routes: {
	albums?: unknown[] | ((term: string) => unknown[]);
	songs?: unknown[];
	errors?: unknown;
}) {
	const fetchMock = vi.fn(async (input: string | URL | Request) => {
		const url = new URL(input instanceof Request ? input.url : String(input));
		const term = url.searchParams.get("term") ?? "";

		if (routes.errors) {
			return json({ errors: routes.errors });
		}

		const albums = typeof routes.albums === "function" ? routes.albums(term) : routes.albums ?? [];
		const payload = url.searchParams.get("types") === "songs"
			? { songs: { data: routes.songs ?? [] } }
			: { albums: { data: albums } };

		return json({ results: payload });
	});

	vi.stubGlobal("fetch", fetchMock);

	return fetchMock;
}

function json(body: unknown) {
	return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const search = { album: "", title: "", artist: "Green Day", year: "2004" };

beforeEach(() => {
	vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("fetchCover", () => {
	it("maps an album match onto the cover response", async () => {
		stubApi({ albums: [album()] });

		const cover = await fetchCover({ ...search, album: "American Idiot" }, "token");

		expect(cover).toEqual({
			album: "American Idiot",
			artist: "Green Day",
			artwork: artwork.url,
			animatedCover: {
				square: "https://video/square.m3u8",
				tall: "https://video/tall.m3u8",
				previewFrame: "https://frame/{w}x{h}.jpg",
			},
		});
	});

	it("resolves the album from a track title when none is given", async () => {
		const fetchMock = stubApi({ songs: [song("Holiday", "American Idiot")], albums: [album()] });

		const cover = await fetchCover({ ...search, title: "Holiday" }, "token");

		expect(cover?.album).toBe("American Idiot");

		// songs search first, then the album search by the resolved name
		const searches = fetchMock.mock.calls.map(([input]) => new URL(String(input)).searchParams);
		expect(searches.map((params) => params.get("types"))).toEqual(["songs", "albums"]);
		expect(searches[1].get("term")).toBe("American Idiot Green Day");
	});

	it("returns null when the album has no animated artwork", async () => {
		stubApi({ albums: [album({}, { editorialVideo: undefined })] });

		expect(await fetchCover({ ...search, album: "American Idiot" }, "token")).toBeNull();
	});

	it("falls back to the track title when the album lookup finds nothing", async () => {
		const fetchMock = stubApi({
			albums: (term) => (term.includes("Best of 2000") ? [] : [album()]),
			songs: [song("American Idiot", "American Idiot")],
		});

		const cover = await fetchCover({ ...search, album: "Best of 2000", title: "American Idiot" }, "token");

		expect(cover?.album).toBe("American Idiot");

		const searches = fetchMock.mock.calls.map(([input]) => new URL(String(input)).searchParams);
		expect(searches.map((params) => params.get("types"))).toEqual(["albums", "songs", "albums"]);
		expect(searches.map((params) => params.get("term"))).toEqual([
			"Best of 2000 Green Day",
			"American Idiot Green Day",
			"American Idiot Green Day",
		]);
	});

	it("prefers the shortest album name when equally scored songs tie", async () => {
		const fetchMock = stubApi({
			songs: [
				song("American Idiot", "American Idiot (Deluxe Edition)"),
				song("American Idiot", "American Idiot"),
			],
			albums: [album()],
		});

		const cover = await fetchCover({ ...search, title: "American Idiot" }, "token");

		expect(cover?.album).toBe("American Idiot");

		const searches = fetchMock.mock.calls.map(([input]) => new URL(String(input)).searchParams);
		expect(searches[1].get("term")).toBe("American Idiot Green Day");
	});

	it("ignores albums by another artist", async () => {
		stubApi({ albums: [album({}, { artistName: "Some Cover Band" })] });

		expect(await fetchCover({ ...search, album: "American Idiot" }, "token")).toBeNull();
	});

	it("ignores albums that only share a stopword with the query", async () => {
		stubApi({ albums: [album({ id: "wall" }, { name: "The Wall", artistName: "Pink Floyd" })] });

		expect(
			await fetchCover({ ...search, album: "The Dark Side of the Moon", artist: "Pink Floyd", year: "" }, "token"),
		).toBeNull();
	});

	it("does not prefer an unrelated album just because it has animated artwork", async () => {
		stubApi({
			albums: [
				album({ id: "self-titled" }, {
					name: "Rage Against the Machine",
					artistName: "Rage Against the Machine",
					releaseDate: "1992-11-06",
					editorialVideo: undefined,
				}),
				album({ id: "battle" }, {
					name: "The Battle of Los Angeles",
					artistName: "Rage Against the Machine",
					releaseDate: "1999-11-02",
				}),
			],
		});

		expect(
			await fetchCover(
				{ ...search, album: "Rage Against the Machine", artist: "Rage Against the Machine", year: "" },
				"token",
			),
		).toBeNull();
	});

	it("swaps in an edition of the album that has animated artwork", async () => {
		stubApi({
			albums: [
				album({ id: "canonical" }, {
					name: "The Dark Side of the Moon",
					artistName: "Pink Floyd",
					releaseDate: "1973-03-01",
					editorialVideo: undefined,
				}),
				album({ id: "fiftieth" }, {
					name: "The Dark Side of the Moon (50th Anniversary) [Remastered]",
					artistName: "Pink Floyd",
					releaseDate: "1973-03-01",
				}),
			],
		});

		const cover = await fetchCover(
			{ ...search, album: "The Dark Side of the Moon", artist: "Pink Floyd", year: "" },
			"token",
		);

		expect(cover?.album).toBe("The Dark Side of the Moon (50th Anniversary) [Remastered]");
	});

	it("returns null on an API error payload", async () => {
		stubApi({ errors: [{ id: "x", title: "Resource Not Found", detail: "nope", status: "404", code: "40400" }] });

		expect(await fetchCover({ ...search, album: "American Idiot" }, "token")).toBeNull();
	});

	it("returns null when neither album nor title is supplied", async () => {
		const fetchMock = stubApi({ albums: [album()] });

		expect(await fetchCover(search, "token")).toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
