let nextSessionId = 0;

export function createLiveMetrics({
  now = () => performance.now(),
  log = (message) => console.log(message),
} = {}) {
  const sessionId = ++nextSessionId;
  const sessionStarted = now();
  let turnStarted;
  let firstAudio = false;
  let latestToolReturned;
  let firstAudioAfterTool = false;
  let turn = 0;
  const record = (event, details = {}) =>
    log(`[Live ${sessionId}] ${JSON.stringify({ event, turn, ...details })}`);
  return {
    ready() {
      record("session_ready", { setupMs: now() - sessionStarted });
    },
    begin() {
      if (turnStarted !== undefined) return false;
      turnStarted = now();
      turn++;
      firstAudio = false;
      latestToolReturned = undefined;
      firstAudioAfterTool = false;
      record("interaction_started");
      return true;
    },
    toolStarted(name) {
      record("tool_started", { name });
    },
    toolFailed(name, details) {
      record("tool_failed", { name, ...details });
    },
    failure(message) {
      record("session_failed", { message });
    },
    tool(name, durationMs, success) {
      record("tool_completed", {
        name,
        durationMs,
        success,
        extraModelRequests: 0,
      });
      if (name !== "show_information_cards") {
        latestToolReturned = now();
        firstAudioAfterTool = false;
      }
    },
    audio() {
      if (turnStarted === undefined) return;
      if (!firstAudio) {
        firstAudio = true;
        record("first_audio", {
          sinceProcessingStartedMs: now() - turnStarted,
        });
      }
      if (latestToolReturned !== undefined && !firstAudioAfterTool) {
        firstAudioAfterTool = true;
        record("first_audio_after_tool", {
          sinceToolReturnedMs: now() - latestToolReturned,
          sinceProcessingStartedMs: now() - turnStarted,
        });
      }
    },
    finish(reason = "idle") {
      if (turnStarted !== undefined)
        record(`interaction_${reason}`, {
          sinceProcessingStartedMs: now() - turnStarted,
        });
      turnStarted = undefined;
    },
  };
}
