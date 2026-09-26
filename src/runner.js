export class ActionRunner {
  constructor({ timeoutMs = 120000, log = () => {} } = {}) {
    this.timeoutMs = timeoutMs;
    this.log = log;
    this.active = null;
  }
  state() { return this.active ? { name: this.active.name, started: this.active.started, stopping: this.active.controller.signal.aborted } : null; }
  stop(reason = 'Stopped by player') {
    if (!this.active) return;
    this.active.controller.abort(new Error(reason));
    this.active.cleanup();
  }
  retire(reason = 'Connection ended') {
    // Only use after the old Minecraft connection has ended. Unsettled operations
    // belong to that dead bot and cannot mutate a replacement connection.
    this.stop(reason);
    this.active = null;
  }
  async run(name, operation, cleanup = () => {}, externalSignal) {
    if (this.active) throw new Error(`Still ${this.active.controller.signal.aborted ? 'stopping' : 'running'} ${this.active.name}. Wait for it to settle.`);
    externalSignal?.throwIfAborted();
    const controller = new AbortController();
    const active = { name, controller, cleanup, started: Date.now() };
    this.active = active;
    const cancel = reason => { controller.abort(new Error(reason)); cleanup(); };
    const abort = () => cancel(externalSignal.reason?.message || 'Cancelled');
    externalSignal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => cancel(`Action timed out after ${this.timeoutMs / 1000}s`), this.timeoutMs);
    timeout.unref?.();
    this.log('action', `Started ${name}`);
    // The lock is released only after the underlying operation settles, even after Stop.
    try {
      const result = await operation(controller.signal);
      controller.signal.throwIfAborted();
      this.log('result', `${name} completed`, result);
      return result;
    } catch (error) {
      // Pathfinder rejects its pending promise with GoalChanged when Stop
      // clears the goal. Preserve the initiating cancellation/timeout reason.
      const failure = controller.signal.aborted ? controller.signal.reason : error;
      this.log('error', `${name}: ${failure.message}`);
      throw failure;
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener('abort', abort);
      cleanup();
      if (this.active === active) this.active = null;
    }
  }
}
