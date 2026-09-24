import { useRef, useState } from "react";
import "./App.css";

const API_URL = "http://localhost:5000";

type NavigationStep = {
  action: string;
  instruction: string;
};

type AssistantResult = {
  success: boolean;
  transcript: string;
  currentScreen: string;
  targetScreen: string;
  steps: NavigationStep[];
  answer: string;
  audio: {
    mimeType: string;
    data: string;
  } | null;
};

const screens = [
  { label: "Home", value: "home.png" },
  { label: "Apps", value: "apps.png" },
  { label: "VOD", value: "vod.png" },
  { label: "Settings", value: "settings.png" },
  { label: "Channels", value: "channels.png" },
];

function App() {
  const [message, setMessage] = useState<string>("");
  const [imageName, setImageName] = useState<string>("home.png");
  const [recording, setRecording] = useState<boolean>(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [result, setResult] = useState<AssistantResult | null>(null);
  const [error, setError] = useState<string>("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const startRecording = async () => {
    try {
      setError("");
      setAudioBlob(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];
      mediaRecorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mediaRecorder.mimeType });
        setAudioBlob(blob);
        stream.getTracks().forEach((track) => track.stop());
      };
      mediaRecorder.start();
      setRecording(true);
    } catch (err) {
      console.error(err);
      setError("Could not access microphone");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop();
      setRecording(false);
    }
  };

  const playBase64Audio = (base64: string, mimeType = "audio/wav") => {
    const byteCharacters = atob(base64);
    const byteNumbers = new Array<number>(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.play().catch((err) => console.error("Audio play error:", err));
    audio.onended = () => URL.revokeObjectURL(url);
  };

  const sendRequest = async () => {
    try {
      setLoading(true);
      setError("");
      setResult(null);
      if (!message.trim() && !audioBlob) {
        setError("Write a message or record your voice");
        return;
      }
      const formData = new FormData();
      formData.append("imageName", imageName);
      if (audioBlob) formData.append("audio", audioBlob, "voice.webm");
      else formData.append("message", message);
      const response = await fetch(`${API_URL}/api/assistant`, { method: "POST", body: formData });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.details || data.error || "Something went wrong");
      }
      const assistantResult = data as AssistantResult;
      setResult(assistantResult);
      if (assistantResult.audio?.data) {
        playBase64Audio(assistantResult.audio.data, assistantResult.audio.mimeType);
      }
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setMessage("");
    setAudioBlob(null);
    setResult(null);
    setError("");
    setImageName("home.png");
  };

  return (
    <div className="app">
      <div className="assistant-card">
        <div className="header">
          <div>
            <h1>TV AI Assistant</h1>
            <p>ספר לי לאן אתה רוצה להגיע</p>
          </div>
          <span className="status">● Online</span>
        </div>

        <div className="section">
          <label>Current TV screen</label>
          <select className="screen-select" value={imageName} onChange={(e) => {
            setImageName(e.target.value);
            setResult(null);
          }}>
            {screens.map((screen) => (
              <option key={screen.value} value={screen.value}>{screen.label}</option>
            ))}
          </select>
          <div className="selected-screen">Selected:
            <strong>{screens.find((screen) => screen.value === imageName)?.label}</strong>
          </div>
        </div>

        <div className="section">
          <label>What do you want to do?</label>
          <textarea
            placeholder="לדוגמה: אני רוצה להגיע לנטפליקס"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            disabled={audioBlob !== null}
          />
        </div>
        <div className="or">OR</div>
        <div className="voice-section">
          {!recording ? (
            <button className="mic-button" onClick={startRecording}>
              <span className="mic-icon">🎤</span>
              <span>Start talking</span>
            </button>
          ) : (
            <button className="mic-button recording" onClick={stopRecording}>
              <span className="mic-icon">⏹</span>
              <span>Stop recording</span>
            </button>
          )}
          {recording && <div className="recording-text">🔴 Listening...</div>}
          {audioBlob && !recording && <div className="audio-ready">✓ Voice recording ready</div>}
        </div>

        <div className="buttons">
          <button className="send-button" onClick={sendRequest} disabled={loading || recording}>
            {loading ? "Thinking..." : "Ask Assistant"}
          </button>
          <button className="reset-button" onClick={reset}>Reset</button>
        </div>

        {error && <div className="error">{error}</div>}
        {loading && <div className="loading"><div className="spinner" /><span>Analyzing your request...</span></div>}

        {result && (
          <div className="result">
            <div className="result-title">Assistant</div>
            {result.transcript && (
              <div className="info-box"><span>You said</span><strong>{result.transcript}</strong></div>
            )}
            <div className="screens">
              <div><span>Current screen</span><strong>{result.currentScreen}</strong></div>
              <div className="arrow">→</div>
              <div><span>Target</span><strong>{result.targetScreen}</strong></div>
            </div>
            <div className="answer">{result.answer}</div>
            <div className="steps">
              <h3>Navigation</h3>
              {result.steps?.map((step, index) => (
                <div className="step" key={`${step.action}-${index}`}>
                  <div className="step-number">{index + 1}</div>
                  <div className="step-content">
                    <strong>{step.instruction}</strong>
                    <span>{step.action}</span>
                  </div>
                </div>
              ))}
            </div>
            {result.audio?.data && (
              <button className="voice-button" onClick={() => playBase64Audio(result.audio!.data, result.audio!.mimeType)}>
                🔊 Play answer again
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;

