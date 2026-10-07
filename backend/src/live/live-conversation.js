import { GoogleGenAI } from "@google/genai";
import "dotenv/config";
import { createAssistantTools, toolErrorDetails } from "../tools/assistant-tools.js";
import { createGeminiLiveConfig, geminiLiveModel } from "./gemini-live-config.js";
import { createLiveMetrics } from "./live-metrics.js";
import { connectGeminiLive } from "./gemini-live-connection.js";
import {
  tvScreenContext,
  screenContextInstruction,
  screenContextMessage,
} from "./tv-screen-context.js";

// Extended Thinking can end an intermediate utterance before its interaction is idle.
export function interactionStatus(message) {
  return (
    message.interactionStatus ||
    message.interaction_status ||
    message.serverContent?.interactionStatus ||
    message.serverContent?.interaction_status
  );
}

export function createLiveConversation(
  socket,
  {
    connect,
    execute,
    getUser,
    getContext,
    subscribeContext,
    metrics = createLiveMetrics(),
    model = geminiLiveModel(),
  } = {},
) {
  let session;
  let closed = false;
  let started = false;
  let assistantTools;
  let sentScreenContext;
  let unsubscribeContext;
  const pushScreenContext = (force = false) => {
    if (closed || !session) return;
    try {
      const snapshot = tvScreenContext(getContext?.());
      if (force || snapshot !== sentScreenContext) {
        if (session.sendClientContent(screenContextMessage(snapshot))) sentScreenContext = snapshot;
      }
    } catch {
      fail("Could not update the current TV screen. Please start a new live conversation.");
    }
  };
  let answerText = "";
  let inputText = "";
  let activeResult;
  let interactionActive = false;
  let hasTurnOutput = false;
  let turnId = 0;
  let audioWindow = performance.now();
  let audioChunks = 0;
  const cancelled = new Set();
  const send = (message) => {
    if (!closed && socket.readyState === 1) {
      if (socket.bufferedAmount > 512000) {
        close();
        socket.close(1013, "Connection is too slow");
        return;
      }
      socket.send(JSON.stringify({ ...message, turnId }));
    }
  };
  const beginTurn = () => {
    if (!metrics.begin()) return;
    turnId++;
    cancelled.clear();
    answerText = "";
    hasTurnOutput = false;
    interactionActive = true;
    activeResult = {
      success: true,
      type: "answer",
      transcript: inputText,
      currentScreen: null,
      targetScreen: null,
      steps: [],
      answer: "",
      presentation: null,
    };
    send({ type: "result", result: activeResult });
  };
  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(setupTimer);
    clearTimeout(durationTimer);
    unsubscribeContext?.();
    session?.close();
  };
  const fail = (message) => {
    if (closed) return;
    metrics.failure(message);
    send({ type: "error", message });
    close();
    socket.close(1011, "Live conversation ended");
  };
  const setupTimer = setTimeout(
    () => fail("Live connection timed out. Please start a new live conversation."),
    20000,
  );
  setupTimer.unref?.();
  const durationTimer = setTimeout(
    () => fail("The 30-minute demo call limit was reached. Start another conversation."),
    30 * 60 * 1000,
  );
  durationTimer.unref?.();

  const onmessage = async (message) => {
    if (closed) return;
    const content = message.serverContent;
    if (message.toolCallCancellation) {
      for (const id of message.toolCallCancellation.ids || []) cancelled.add(id);
    }
    if (content?.interrupted) {
      turnId++;
      metrics.finish("interrupted");
      interactionActive = false;
      hasTurnOutput = false;
      inputText = "";
      activeResult = undefined;
      send({ type: "interrupted" });
    }
    const status =
      interactionStatus(message) ||
      (model !== "gemini-3.8-live-extended-thinking" &&
      content?.turnComplete &&
      (hasTurnOutput ||
        content.outputTranscription?.text ||
        content.modelTurn?.parts?.some((part) => part.inlineData))
        ? "IDLE"
        : undefined);
    if (
      status === "IN_PROGRESS" ||
      message.toolCall?.functionCalls?.length ||
      ((!activeResult ||
        (model === "gemini-3.8-live" &&
          !interactionActive &&
          (inputText || content?.modelTurn?.parts?.some((part) => part.inlineData)))) &&
        (content?.outputTranscription?.text ||
          content?.modelTurn?.parts?.some((part) => part.inlineData)))
    )
      beginTurn();
    if (status) send({ type: "status", status });
    if (content?.inputTranscription?.text) {
      inputText = (inputText + content.inputTranscription.text).slice(-12000);
      send({
        type: "transcript",
        speaker: "user",
        text: content.inputTranscription.text,
      });
      if (interactionActive) {
        activeResult = { ...activeResult, transcript: inputText };
        send({ type: "result", result: activeResult });
      }
    }
    if (content?.outputTranscription?.text) {
      hasTurnOutput = true;
      answerText = (answerText + content.outputTranscription.text).slice(-12000);
      send({
        type: "transcript",
        speaker: "nova",
        text: content.outputTranscription.text,
      });
      activeResult = {
        ...activeResult,
        answer: answerText,
        transcript: inputText || activeResult.transcript,
      };
      send({ type: "result", result: activeResult });
    }
    for (const part of content?.modelTurn?.parts || []) {
      if (part.inlineData?.mimeType?.startsWith("audio/pcm")) {
        hasTurnOutput = true;
        metrics.audio();
        send({ type: "audio", ...part.inlineData });
      }
    }
    // Keep receiving messages after turnComplete, including later tool calls and audio.
    if (content?.turnComplete) {
      if (answerText && !answerText.endsWith("\n")) answerText += "\n";
      send({ type: "utterance_end" });
    }
    const messageTurn = turnId;
    await Promise.all(
      (message.toolCall?.functionCalls || []).map(async (call) => {
        const toolTurn = turnId;
        let response;
        let outcome;
        const toolStarted = performance.now();
        metrics.toolStarted(call.name);
        try {
          outcome = await (execute || assistantTools)(call);
          if (closed || cancelled.has(call.id) || toolTurn !== turnId) return;
          if (
            call.name !== "show_information_cards" ||
            outcome.result.lookupId === activeResult?.lookupId
          ) {
            activeResult = {
              ...outcome.result,
              answer: answerText,
              transcript: inputText || outcome.result.transcript,
            };
            send({ type: "result", result: activeResult });
          }
          response = outcome.response;
        } catch (error) {
          const details = toolErrorDetails(error);
          metrics.toolFailed(call.name, details);
          response = {
            ...details,
            instruction:
              "For invalid arguments, correct them using the catalog and retry. For sign-in/session errors, ask the user to sign in again. Otherwise say the requested information could not be retrieved. Do not describe argument mistakes or missing data as a system outage. Do not invent facts.",
          };
        }
        if (!closed && !cancelled.has(call.id) && toolTurn === turnId) {
          try {
            session.sendToolResponse({
              functionResponses: [{ id: call.id, name: call.name, response }],
            });
            metrics.tool(call.name, performance.now() - toolStarted, Boolean(outcome));
          } catch {
            fail("Could not return Nova's answer. Please try again.");
          }
        }
      }),
    );
    if (status === "IDLE" && !closed && messageTurn === turnId) {
      metrics.finish();
      interactionActive = false;
      hasTurnOutput = false;
      inputText = "";
    }
  };

  socket.on("message", async (data, isBinary) => {
    try {
      if (isBinary) throw new Error("Expected a JSON message");
      const message = JSON.parse(data.toString());
      if (message.type === "start" && !started) {
        started = true;
        const config = createGeminiLiveConfig({ model });
        sentScreenContext = tvScreenContext(getContext?.());
        config.systemInstruction += `\n${screenContextInstruction}\nInitial TV_SCREEN_CONTEXT:\n${sentScreenContext}`;
        unsubscribeContext = subscribeContext?.(() => pushScreenContext());
        assistantTools = createAssistantTools("home.png", {
          getUser,
          getContext,
        });
        const connector =
          connect ||
          ((options) =>
            new GoogleGenAI({
              apiKey: process.env.GEMINI_API_KEY,
              httpOptions: { apiVersion: "v1alpha" },
            }).live.connect(options));
        session = await connectGeminiLive({
          connect: connector,
          model,
          config,
          onmessage,
          onReconnect: () => send({ type: "status", status: "RECONNECTING" }),
          onReady: () => {
            pushScreenContext(true);
            send({ type: "ready", resumed: true });
          },
          onFailure: fail,
        });
        if (closed) {
          session.close();
          return;
        }
        clearTimeout(setupTimer);
        pushScreenContext(); // Catch page changes that happened while Gemini was connecting.
        metrics.ready();
        send({ type: "ready" });
      } else if (message.type === "audio" && session && !closed) {
        if (performance.now() - audioWindow >= 1000) {
          audioWindow = performance.now();
          audioChunks = 0;
        }
        if (++audioChunks > 100) throw new Error("Audio rate limit exceeded");
        if (
          typeof message.data !== "string" ||
          message.data.length > 24000 ||
          !/^[A-Za-z0-9+/]+={0,2}$/.test(message.data)
        )
          throw new Error("Invalid audio chunk");
        const pcm = Buffer.from(message.data, "base64");
        if (
          pcm.length < 2 ||
          pcm.length > 4096 ||
          pcm.length % 2 ||
          pcm.toString("base64") !== message.data
        )
          throw new Error("Invalid PCM samples");
        session.sendRealtimeInput({
          audio: { data: message.data, mimeType: "audio/pcm;rate=16000" },
        });
      } else if (message.type === "stop") {
        close();
        socket.close(1000);
      } else throw new Error("Invalid live message or session not ready");
    } catch (error) {
      fail(
        started
          ? "Could not start or continue live voice. Please start a new live conversation."
          : error.message,
      );
    }
  });
  socket.on("close", close);
  socket.on("error", close);
  return { onmessage, close };
}
