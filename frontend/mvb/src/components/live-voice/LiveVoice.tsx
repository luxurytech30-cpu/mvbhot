import type { AssistantResult } from "../../types/assistant";
import { useLiveVoice } from "../../hooks/useLiveVoice";
import type { LiveVoiceState } from "../../hooks/useLiveVoice";
import "./LiveVoice.css";
const labels: Record<LiveVoiceState, string> = {
  off: "Start live conversation",
  connecting: "Connecting…",
  reconnecting: "Reconnecting… please wait",
  listening: "Listening to you…",
  thinking: "Nova is working…",
  speaking: "Nova is speaking…",
};
export default function LiveVoice(props: {
  apiUrl: string;
  onResult: (result: AssistantResult) => void;
  onError: (message: string) => void;
  onActive: (active: boolean) => void;
}) {
  const { state, transcript, start, stop } = useLiveVoice(props);
  return (
    <section className="live-voice" aria-label="Live voice conversation">
      <button
        className={`live-button ${state !== "off" ? "active" : ""}`}
        onClick={() => (state === "off" ? void start() : stop())}
      >
        <span aria-hidden="true">◖))</span> {state === "off" ? labels.off : "End conversation"}
      </button>
      <p role="status">
        {state === "off"
          ? "Talk naturally with Nova. You can interrupt and ask follow-up questions."
          : labels[state]}
      </p>
      {state !== "off" && (
        <span className="live-hint">Microphone is on · Headphones work best</span>
      )}
      {(transcript.user.trim() || transcript.nova.trim()) && (
        <div className="live-transcript">
          {transcript.user.trim() && (
            <div>
              <strong>You</strong>
              <p dir="auto">{transcript.user}</p>
            </div>
          )}
          {transcript.nova.trim() && (
            <div>
              <strong>Nova</strong>
              <p dir="auto">{transcript.nova}</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
