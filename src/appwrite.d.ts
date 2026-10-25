// The Appwrite Functions handler contract for node-* runtimes. Appwrite does not
// ship @types for this, only docs, so it lives here.
interface AppwriteRequest {
	method: string;
	path: string;
	query: Record<string, string | string[] | undefined>;
	queryString: string;
	headers: Record<string, string>;
	body: string;
}

interface AppwriteResponse {
	json(body: unknown, status?: number, headers?: Record<string, string>): unknown;
	send(body: string, status?: number, headers?: Record<string, string>): unknown;
	text(body: string, status?: number, headers?: Record<string, string>): unknown;
	empty(): unknown;
}

interface AppwriteContext {
	req: AppwriteRequest;
	res: AppwriteResponse;
	log(message: string): void;
	error(message: string): void;
}
