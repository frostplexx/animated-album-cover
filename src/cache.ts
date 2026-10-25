import { createHash } from "node:crypto";
import { Client, TablesDB, AppwriteException, Query } from "node-appwrite";

const DATABASE_ID = process.env.COVER_CACHE_DATABASE_ID ?? "cover-cache";
const TABLE_ID = process.env.COVER_CACHE_TABLE_ID ?? "covers";

export interface CoverCache {
	get<T>(key: string): Promise<T | undefined>;
	set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
	/** Deletes every row whose TTL has passed. Returns how many went. */
	prune(): Promise<number>;
}

// Appwrite gives a function an ephemeral API key per execution (x-appwrite-key),
// which is all the table access we need. Without one (e.g. local runs) the cache
// is disabled rather than failing the request.
export function createCache(apiKey: string | undefined): CoverCache | undefined {
	if (!apiKey) return undefined;

	// Each execution gets a fresh key, so the Client is per-call; TablesDB is just
	// a thin wrapper around it.
	const client = new Client()
		.setEndpoint(process.env.APPWRITE_FUNCTION_API_ENDPOINT ?? "")
		.setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID ?? "")
		.setKey(apiKey);

	return new TableCache(new TablesDB(client));
}

class TableCache implements CoverCache {
	constructor(private readonly tables: TablesDB) {}

	async get<T>(key: string): Promise<T | undefined> {
		const rowId = rowIdFor(key);

		try {
			const row = await this.tables.getRow({ databaseId: DATABASE_ID, tableId: TABLE_ID, rowId });

			if (Number(row.expiresAt) <= epoch()) {
				await this.delete(rowId);
				return undefined;
			}

			return JSON.parse(row.payload as string) as T;
		} catch (err) {
			// A missing row is a miss; anything else is logged and treated as one too.
			if (!(err instanceof AppwriteException) || err.code !== 404) {
				console.error("Cover cache read failed:", err);
			}

			return undefined;
		}
	}

	async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
		try {
			await this.tables.upsertRow({
				databaseId: DATABASE_ID,
				tableId: TABLE_ID,
				rowId: rowIdFor(key),
				data: {
					payload: JSON.stringify(value),
					expiresAt: epoch() + ttlSeconds,
				},
			});
		} catch (err) {
			console.error("Cover cache write failed:", err);
		}
	}

	private async delete(rowId: string): Promise<void> {
		try {
			await this.tables.deleteRow({ databaseId: DATABASE_ID, tableId: TABLE_ID, rowId });
		} catch {
			// Expiry cleanup is best effort.
		}
	}

	// Reads only evict the rows they touch, so unread entries would otherwise live
	// forever. The function's schedule runs this (see appwrite.config.json).
	async prune(): Promise<number> {
		try {
			const result = await this.tables.deleteRows({
				databaseId: DATABASE_ID,
				tableId: TABLE_ID,
				queries: [Query.lessThanEqual("expiresAt", epoch())],
			});

			return result.total;
		} catch (err) {
			console.error("Cover cache prune failed:", err);
			return 0;
		}
	}
}

// Row IDs allow 36 alphanumerics/dots/dashes/underscores, so hash the arbitrary
// cache key instead of trying to encode it.
function rowIdFor(key: string): string {
	return createHash("sha256").update(key).digest("hex").slice(0, 32);
}

function epoch(): number {
	return Math.floor(Date.now() / 1000);
}
