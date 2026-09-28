import pg from "pg";

/**
 * pg 8 already queues queries issued concurrently on one connection, but warns that the
 * behaviour disappears in pg 9. Interactive transactions run every query on a single
 * connection and domain code reads several things at once (Promise.all), so this client
 * chains its queries explicitly: same ordering and results, no reliance on the deprecated
 * internal queue.
 */
class SerialClient extends pg.Client {
  constructor(config?: string | pg.ClientConfig) {
    super(config);
    const base = pg.Client.prototype.query.bind(this) as (...args: unknown[]) => unknown;
    let chain: Promise<unknown> = Promise.resolve();
    (this as unknown as { query: (...args: unknown[]) => unknown }).query = (...args: unknown[]) => {
      const last = args[args.length - 1];
      const first = args[0] as { submit?: unknown } | undefined;
      // Callback-style calls and submittables (cursors, streams) keep pg's own handling.
      if (typeof last === "function" || typeof first?.submit === "function") return base(...args);
      const run = () => base(...args) as Promise<unknown>;
      const result = chain.then(run, run);
      chain = result.catch(() => undefined);
      return result;
    };
  }
}

export function serialPool(connectionString: string, max: number) {
  return new pg.Pool({ connectionString, max, idleTimeoutMillis: 30_000, Client: SerialClient });
}
