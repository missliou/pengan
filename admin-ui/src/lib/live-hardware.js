// Small read-only subscription for device/system pages. PageScope owns both the
// timer and read cancellation; local expiry continues while a request is waiting.
export function watchHardware(ctx, initial, render) {
  let observation = initial, busy = false, nextRead = Date.now() + 2000;
  function paint() {
    if (!ctx.scope.active) return;
    const current = ctx.demoMode ? observation : ctx.live.current();
    ctx.state.hardwareOnline = current?.hardware?.deviceOnline === true;
    render(current?.hardware || null); ctx.markStatus();
  }
  async function read() {
    if (busy || !ctx.scope.active) return;
    busy = true; nextRead = Date.now() + 2000;
    try { const result = await ctx.dataSource.getObservations(); if (ctx.scope.active) observation = result; }
    catch { if (ctx.scope.active) { observation = null; if (!ctx.demoMode) ctx.live.invalidate(); } }
    finally { busy = false; if (ctx.scope.active) paint(); }
  }
  const timer = setInterval(() => { paint(); if (Date.now() >= nextRead) read(); }, 500);
  ctx.scope.onDispose(() => clearInterval(timer));
  paint();
}
