# animated-album-cover

Tiny API that resolves an album or track to its animated (motion) Apple Music artwork.

Runs as an Appwrite Function. See [DEPLOY.md](./DEPLOY.md) for deployment and the
cache setup.

## Request

```
GET https://<function-domain>/?album=Battery&artist=Metallica
GET https://<function-domain>/?title=Holiday&artist=Green+Day
```

| param | |
|---|---|
| `album` | album name; omit it and the album is resolved from `title` |
| `title` | track name, used to find the album when `album` is unknown |
| `artist` | required for a usable match |
| `year` | optional tiebreaker between editions |
| `isrc` | optional, echoed back untouched |
| `storefront` | optional Apple storefront, default `us` |

## Response

```json
{
	"album": "American Idiot",
	"artist": "Green Day",
	"artwork": "https://…/{w}x{h}bb.jpg",
	"animatedCover": {
		"square": "https://…/…_default.m3u8",
		"tall": "https://…/…_default.m3u8",
		"previewFrame": "https://…/{w}x{h}bb.jpg"
	},
	"isrc": "USRE10400888"
}
```

`404` means the album exists but has no animated artwork (or nothing matched).
`artwork` and `animatedCover.previewFrame` are URL templates with `{w}x{h}`.

## Local

```bash
npm install
npm run dev        # appwrite run function
npm test           # vitest, fetch stubbed
npm run typecheck
npm run build      # esbuild -> dist/main.js
```
