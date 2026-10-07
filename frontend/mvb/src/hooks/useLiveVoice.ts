import { useEffect, useRef, useState } from "react";
import type { AssistantResult } from "../types/assistant";
import {
  captureMicrophone,
  clearPlayback,
  encodeMicrophoneAudio,
  LiveAudioError,
  playPcmAudio,
  releaseLiveCall,
} from "../audio/live-audio";
import type { LiveCall } from "../audio/live-audio";

export type LiveVoiceState =
  "off" | "connecting" | "reconnecting" | "listening" | "thinking" | "speaking";
export function useLiveVoice({
  apiUrl,
  onResult,
  onError,
  onActive,
}: {
  apiUrl: string;
  onResult: (result: AssistantResult) => void;
  onError: (message: string) => void;
  onActive: (active: boolean) => void;
}) {
  const [state, setState] = useState<LiveVoiceState>("off");
  const [transcript, setTranscript] = useState({ user: "", nova: "" });
  const callRef = useRef<LiveCall | null>(null);

  const stop = (call = callRef.current) => {
    if (!call || call.closed) return;
    releaseLiveCall(call);
    if (callRef.current === call) {
      callRef.current = null;
      setState("off");
      onActive(false);
    }
  };

  // Unmount or account switch ends the call and releases microphone/playback.
  useEffect(
    () => () => {
      const call = callRef.current;
      if (call) {
        releaseLiveCall(call);
        callRef.current = null;
        onActive(false);
      }
    },
    [onActive],
  );

  const start = async () => {
    if (callRef.current && !callRef.current.closed) return;
    const call: LiveCall = {
      sources: new Set(),
      playAt: 0,
      busy: false,
      closed: false,
    };
    const setupStarted = performance.now();
    callRef.current = call;
    setState("connecting");
    onActive(true);
    setTranscript({ user: "", nova: "" });
    onError("");
    const refresh = () => {
      if (!call.closed)
        setState(call.sources.size ? "speaking" : call.busy ? "thinking" : "listening");
    };
    const fail = (message: string) => {
      if (call.closed) return;
      onError(message);
      stop(call);
    };
    try {
      await captureMicrophone(call);
      if (call.closed) return;
      const url = new URL("/api/live", apiUrl);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      call.socket = new WebSocket(url);
      call.timer = window.setTimeout(
        () => fail("Live voice timed out. Please start a new live conversation."),
        22000,
      );
      call.socket.onopen = () => {
        if (!call.closed) call.socket?.send(JSON.stringify({ type: "start" }));
      };
      call.socket.onerror = () =>
        fail("Could not connect to live voice. Please start a new live conversation.");
      call.socket.onclose = () => {
        window.clearTimeout(call.timer);
        fail("Live conversation ended. You can start another call.");
      };
      call.socket.onmessage = (event) => {
        if (call.closed) return;
        try {
          const message = JSON.parse(event.data);
          if (message.type === "ready") {
            call.busy = false;
            console.info("[Nova live]", {
              event: "session_ready",
              setupMs: performance.now() - setupStarted,
            });
            window.clearTimeout(call.timer);
            call.microphone!.port.onmessage = (event) => {
              if (call.closed || call.socket?.readyState !== WebSocket.OPEN) return;
              if (call.socket.bufferedAmount > 128000) {
                fail("Live connection is too slow. Please try again.");
                return;
              }
              call.socket.send(
                JSON.stringify({ type: "audio", data: encodeMicrophoneAudio(event.data) }),
              );
            };
            refresh();
          } else if (message.type === "status") {
            if (message.status === "RECONNECTING") {
              setState("reconnecting");
              return;
            }
            if (message.status === "IN_PROGRESS" && !call.busy) {
              call.processingStarted = performance.now();
              call.playbackLogged = false;
            }
            call.busy = message.status !== "IDLE";
            refresh();
          } else if (message.type === "audio") {
            playPcmAudio(call, message, refresh);
            refresh();
          } else if (message.type === "interrupted") {
            call.busy = false;
            call.processingStarted = undefined;
            call.playbackLogged = false;
            clearPlayback(call);
            refresh();
          } else if (message.type === "transcript" && ["user", "nova"].includes(message.speaker)) {
            const speaker = message.speaker as "user" | "nova";
            setTranscript((previous) => ({
              ...previous,
              [speaker]: (previous[speaker] + message.text).slice(-12000),
            }));
          } else if (message.type === "utterance_end") {
            setTranscript((previous) => ({
              user: previous.user + "\n",
              nova: previous.nova + "\n",
            }));
          } else if (message.type === "result") onResult(message.result);
          else if (message.type === "error") fail(message.message);
        } catch (error) {
          fail(
            error instanceof LiveAudioError
              ? error.message
              : "Could not process live audio. Please try again.",
          );
        }
      };
    } catch (error) {
      fail(
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "Allow microphone access to start a live conversation."
          : "Could not start live voice. Please start a new live conversation.",
      );
    }
  };

  return { state, transcript, start, stop: () => stop() };
}
