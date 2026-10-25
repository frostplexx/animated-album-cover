type Sink = (...messages: unknown[]) => void;

// Appwrite's context.log()/context.error() only exist inside the handler, so the
// other modules reach them through this switch. The console fallback keeps `npm
// test` and the local harnesses working, and is what the runtime warns about when
// it sees it — "Native logs detected".
let logSink: Sink = (...messages) => console.log(...messages);
let errorSink: Sink = (...messages) => console.error(...messages);

export function bindLogger(log: Sink, error: Sink): void {
	logSink = log;
	errorSink = error;
}

// Errors are passed as objects: the runtime prints their stack, and anything else
// is serialised for you.
export const logger = {
	log: (...messages: unknown[]): void => logSink(...messages),
	error: (...messages: unknown[]): void => errorSink(...messages),
};
