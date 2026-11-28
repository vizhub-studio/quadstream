// Cooperative main-thread work: one bounded slice per animation frame.
// The budget is soft: a single item or final batch stroke cannot be preempted.
export function createFrameBatches({
  requestFrame = (callback) => requestAnimationFrame(callback),
  cancelFrame = (id) => cancelAnimationFrame(id),
  now = () => performance.now(),
  maxItems = 500,
  budgetMs = 4,
} = {}) {
  if (!Number.isInteger(maxItems) || maxItems < 1 || !(budgetMs > 0))
    throw new Error("Invalid frame batch limits");
  let active = null;
  function cancel() {
    const job = active;
    active = null;
    if (job?.raf != null) cancelFrame(job.raf);
  }
  function start(items, { begin, visit, end }) {
    let index = 0;
    return startWork(
      () => index < items.length,
      () => visit(items[index++]),
      { begin, end },
    );
  }
  function startWork(hasWork, step, { begin, end, complete }) {
    cancel();
    if (!hasWork()) {
      complete?.();
      return;
    }
    const job = { raf: null };
    active = job;
    function slice() {
      if (active !== job) return;
      job.raf = null;
      const deadline = now() + budgetMs;
      begin();
      try {
        let count = 0;
        do {
          step();
          count++;
        } while (
          active === job &&
          hasWork() &&
          count < maxItems &&
          now() < deadline
        );
      } finally {
        end();
      }
      if (active !== job) return;
      if (hasWork()) job.raf = requestFrame(slice);
      else {
        active = null;
        complete?.();
      }
    }
    job.raf = requestFrame(slice);
  }
  return { start, startWork, cancel };
}
