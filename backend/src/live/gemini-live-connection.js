// Provider reconnections remain inside the authenticated browser session.
// Resume handles are never sent to the browser or shared between customers.
export async function connectGeminiLive({
  connect,
  model,
  config,
  onmessage,
  onReconnect,
  onReady,
  onFailure,
}) {
  let session;
  let closed = false;
  let resuming = false;
  let epoch = 0;
  let handle;
  let attempts = 0;
  const close = () => {
    if (closed) return;
    closed = true;
    epoch++;
    session?.close();
  };
  async function open() {
    const current = ++epoch;
    const pending = connect({
      model,
      config: { ...config, sessionResumption: handle ? { handle } : {} },
      callbacks: {
        onmessage: async (message) => {
          if (closed || current !== epoch) return;
          const update = message.sessionResumptionUpdate;
          if (update) {
            handle = update.resumable ? update.newHandle || handle : undefined;
            if (handle) attempts = 0;
          }
          await onmessage(message);
          if (message.goAway && !closed && current === epoch) void reconnect();
        },
        onerror: () => {
          if (!closed && current === epoch && !resuming) void reconnect();
        },
        onclose: () => {
          if (!closed && current === epoch && !resuming) void reconnect();
        },
      },
    });
    let timer;
    try {
      const next = await Promise.race([
        pending,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("Provider connection timed out")), 20000);
          timer.unref?.();
        }),
      ]);
      if (closed || current !== epoch) {
        next.close();
        return;
      }
      session = next;
    } catch (error) {
      // Dispose a connection that resolves after its timeout or cancellation.
      epoch++;
      void pending.then((next) => next.close()).catch(() => {});
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  async function reconnect() {
    if (closed || resuming) return;
    if (!handle) {
      onFailure("The live connection ended. Start another conversation.");
      return;
    }
    resuming = true;
    epoch++; // Old callbacks cannot end or modify the resumed conversation.
    session?.close();
    onReconnect();
    while (!closed && attempts < 2) {
      attempts++;
      try {
        await open();
        if (closed) return;
        resuming = false;
        onReady();
        return;
      } catch {
        /* Try the same private handle once more. */
      }
    }
    if (!closed) onFailure("Could not reconnect live voice. Start another conversation.");
  }
  await open();
  return {
    close,
    sendRealtimeInput(message) {
      if (!closed && !resuming) session?.sendRealtimeInput(message);
    },
    sendClientContent(message) {
      if (closed || resuming) return false;
      session.sendClientContent(message);
      return true;
    },
    sendToolResponse(message) {
      if (closed || resuming) throw new Error("Provider is reconnecting");
      session.sendToolResponse(message);
    },
  };
}
