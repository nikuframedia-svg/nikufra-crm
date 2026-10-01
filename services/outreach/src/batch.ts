export async function runConcurrentBatch<T, R>(items: readonly T[], handler: (item: T, index: number) => Promise<R>, concurrency = 8) {
  const limit = Math.max(1, Math.min(64, Math.floor(concurrency)));
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      try {
        results[index] = { status: "fulfilled", value: await handler(items[index]!, index) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }));
  return results;
}
