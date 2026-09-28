// Cooperative yielding, so the ~0.5-1.5 s beach build runs as short slices instead of one long task.

/** Yield to the event loop once. scheduler.yield() resumes ahead of other queued tasks where supported. */
export function yieldToMain() {
  if (globalThis.scheduler?.yield) return globalThis.scheduler.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * An async checkpoint that only yields once `budgetMs` of work has piled up since the last yield,
 * so the build stays responsive without paying for dozens of needless yields.
 * @param {number} [budgetMs=40]
 * @returns {() => Promise<void>}
 */
export function makeYielder(budgetMs = 40) {
  let last = performance.now();
  return async () => {
    if (performance.now() - last < budgetMs) return;
    await yieldToMain();
    last = performance.now();
  };
}
