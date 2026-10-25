# Deploying to Appwrite

The function is a single Appwrite Function (`node-26`) that answers plain HTTP GETs.
Caching lives in a TablesDB table, because Appwrite has no equivalent of Cloudflare's
edge cache.

## Layout

```
appwrite.config.json   project, function and cache-table definitions
src/main.ts            Appwrite handler: query parsing, CORS, cache, token, lookup
src/cover.ts           Apple Music search + album/edition scoring (runtime agnostic)
src/token.ts           Bearer-token scrape, memoized in memory and in the cache table
src/cache.ts           TablesDB-backed TTL cache
src/types.ts           Apple Music payload types
dist/main.js           esbuild bundle, built by the function's `commands`
```

`appwrite.config.json` sets `commands` to `npm install && npm run build`, so Appwrite
builds the bundle itself — `dist/` never needs to be committed.

## First deploy

```bash
npm install          # also installs the Appwrite CLI (devDependency)
npx appwrite login
```

The CLI ships as `appwrite-cli`, whose binary is named `appwrite` — so with it in
`devDependencies`, `npx appwrite …` (and the `npm run dev` / `npm run deploy`
scripts, which get `node_modules/.bin` on PATH) resolves. Without installing it,
`npx appwrite-cli@latest …` works but `npx appwrite …` does not: the `appwrite`
package on npm is the client SDK and has no binary.

Point `appwrite.config.json` at your project: set `projectId` (and `endpoint` if you
self-host). Then create the cache table and the function:

```bash
npx appwrite push table --force
npx appwrite push function --function-id animated-album-cover --activate --force
```

Then, in the Appwrite Console:

1. **Function → Settings → Scopes** — grant row read and write on the cache table
   (`rows.read`, `rows.write`, or whatever this Appwrite version calls them). Without
   these the ephemeral key cannot touch `cover-cache`, and `src/cache.ts` silently
   degrades to no caching (it logs `Cover cache read/write failed`).
2. **Function → Settings → Domains** — add a domain. The function URL is
   `https://<domain>/`; that is the base URL the TIDAL plugin should call.
3. **Function → Settings → Execute access** — must allow `any` for browser calls
   (`execute: ["any"]` in the config already asks for this).

Optional function variables: `COVER_CACHE_DATABASE_ID` (default `cover-cache`) and
`COVER_CACHE_TABLE_ID` (default `covers`) if you renamed the table.

## Local development

```bash
npm run dev     # appwrite run function, needs the Appwrite CLI and Docker
npm run build   # rebuild dist/main.js
npm test        # vitest against src/cover.ts with fetch stubbed
npm run typecheck
```

`npm run dev` proxies a local request into the function container. Without an
Appwrite API key in the request the cache is disabled, so every request is a real
Apple lookup (roughly 0.5–1 s warm).

## Cache behaviour

- One row per `storefront + album + title + artist + year`, row ID is the SHA-256 of
  that key (Appwrite row IDs cap at 36 chars).
- Rows carry `payload` (JSON) and `expiresAt` (epoch seconds).
- **TTL:** 7 days for covers (`COVER_CACHE_TTL_SECONDS` overrides it), the JWT's
  remaining lifetime for the token.
- **Eviction:** two paths. Reads check `expiresAt` and delete the row they touched;
  a scheduled execution sweeps the rest — `schedule: "0 3 * * *"` in
  `appwrite.config.json` invokes the function with `x-appwrite-trigger: schedule`,
  which runs `deleteRows` with `lessThanEqual("expiresAt", now)` and answers
  `{ "pruned": n }`. Scheduled runs never call Apple.
- The sweep needs the same `rows.read` / `rows.write` scopes as the lookups; without
  them it logs `Cover cache prune failed` and reports `pruned: 0`.
- The ISRC is not part of the key: it is attached to the response per request, so
  every track of an album shares one row.
- 404s are not cached. A track without animated artwork costs one Apple lookup per
  session (the plugin memoizes the miss client-side).

## Differences from the Cloudflare version

- No edge cache and no request collapsing: two concurrent misses both call Apple.
- Cache reads/writes are network round trips to TablesDB (tens of ms), not local.
- Cold starts re-scrape the token unless the cache row is still valid.
