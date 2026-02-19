async function* itemIterator<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) {
    yield item;
  }
}

async function processWorker<T>(
  iterator: AsyncGenerator<T>,
  handler: (item: T) => Promise<unknown>,
): Promise<void> {
  for await (const item of iterator) {
    await handler(item);
  }
}

export async function processPool<T>(
  items: T[],
  handler: (item: T) => Promise<unknown>,
  maxConcurrency: number,
): Promise<void> {
  const iterator = itemIterator(items);
  const workers = Array.from(
    { length: Math.min(maxConcurrency, items.length) },
    () => processWorker(iterator, handler),
  );
  await Promise.allSettled(workers);
}
