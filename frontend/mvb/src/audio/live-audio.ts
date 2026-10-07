export type LiveCall = {
  socket?: WebSocket;
  context?: AudioContext;
  stream?: MediaStream;
  microphone?: AudioWorkletNode;
  sources: Set<AudioBufferSourceNode>;
  playAt: number;
  busy: boolean;
  closed: boolean;
  timer?: number;
  processingStarted?: number;
  playbackLogged?: boolean;
};

export class LiveAudioError extends Error {}

export function clearPlayback(call: LiveCall) {
  call.sources.forEach((source) => {
    source.onended = null;
    source.stop();
    source.disconnect();
  });
  call.sources.clear();
  call.playAt = 0;
}

export function releaseLiveCall(call: LiveCall) {
  if (call.closed) return;
  call.closed = true;
  window.clearTimeout(call.timer);
  call.stream?.getTracks().forEach((track) => track.stop());
  call.microphone?.disconnect();
  clearPlayback(call);
  void call.context?.close();
  call.socket?.close();
}

export function encodeMicrophoneAudio(data: ArrayBuffer) {
  let binary = "";
  for (const byte of new Uint8Array(data)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function captureMicrophone(call: LiveCall) {
  call.context = new AudioContext();
  await call.context.resume();
  if (call.closed) return;
  call.stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  if (call.closed) {
    call.stream.getTracks().forEach((track) => track.stop());
    return;
  }
  await call.context.audioWorklet.addModule(`${import.meta.env.BASE_URL}nova-microphone.js`);
  if (call.closed) return;
  call.microphone = new AudioWorkletNode(call.context, "nova-microphone");
  call.context.createMediaStreamSource(call.stream).connect(call.microphone);
  call.microphone.connect(call.context.destination);
}

export function playPcmAudio(
  call: LiveCall,
  message: { data: string; mimeType: string },
  onPlaybackEnd: () => void,
) {
  const context = call.context!;
  if (call.playAt - context.currentTime > 20 || call.sources.size > 512) {
    throw new LiveAudioError("Audio playback fell behind. Please start another conversation.");
  }
  const binary = atob(message.data);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  const rate = Number(/rate=(\d+)/.exec(message.mimeType)?.[1] || 24000);
  const buffer = context.createBuffer(1, Math.floor(bytes.length / 2), rate);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  call.sources.add(source);
  source.onended = () => {
    source.disconnect();
    call.sources.delete(source);
    onPlaybackEnd();
  };
  call.playAt = Math.max(call.playAt, context.currentTime + 0.02);
  source.start(call.playAt);
  if (!call.playbackLogged) {
    call.playbackLogged = true;
    console.info("[Nova live]", {
      event: "first_playback_scheduled",
      sinceProcessingStatusMs:
        call.processingStarted === undefined ? null : performance.now() - call.processingStarted,
      queuedAudioMs: (call.playAt - context.currentTime) * 1000,
    });
  }
  call.playAt += buffer.duration;
}
