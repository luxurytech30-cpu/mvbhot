import { useState } from "react";
import "./App.css";
import AnswerDetails from "./components/answer-details/AnswerDetails";
import LiveVoice from "./components/live-voice/LiveVoice";
import type { AssistantResult } from "./types/assistant";
import AccountGate from "./components/account/AccountGate";

const API_URL = import.meta.env.VITE_API_URL || window.location.origin;

function App() {
  return (
    <AccountGate apiUrl={API_URL}>
      <Assistant />
    </AccountGate>
  );
}
function Assistant() {
  const [liveActive, setLiveActive] = useState(false);
  const [result, setResult] = useState<AssistantResult | null>(null);
  const [error, setError] = useState("");

  return (
    <div className="app">
      <div className="ambient ambient-one" aria-hidden="true" />
      <div className="ambient ambient-two" aria-hidden="true" />
      <div className="assistant-card">
        <div className="header">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              ✦
            </span>
            <span className="brand-name">
              nova<span className="brand-dot">.</span>
            </span>
          </div>
          <span className="status">
            <span className="status-dot" /> {liveActive ? "LIVE CONVERSATION" : "READY TO TALK"}
          </span>
        </div>

        <div className="intro">
          <div className="eyebrow">
            <span className="eyebrow-line" /> YOUR TV COMPANION
          </div>
          <h1>
            Where would you like <em>to go?</em>
          </h1>
          <p>
            Talk naturally with Nova. It follows the page you are viewing in NOVA TV automatically.
          </p>
        </div>

        <div className="section live-section">
          <div className="section-heading">
            <span className="section-number">01</span>
            <h2>Talk with Nova</h2>
          </div>
          <LiveVoice
            apiUrl={API_URL}
            onResult={setResult}
            onError={setError}
            onActive={setLiveActive}
          />
        </div>

        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}

        {result &&
          Boolean(
            result.answer.trim() ||
            result.steps.length > 0 ||
            result.presentation?.cards.length ||
            result.presentation?.invoices.length,
          ) && (
            <div className="result">
              <div className="result-title">
                <span className="result-sparkle">✦</span>{" "}
                {result.type === "navigation" ? "Your route with Nova" : "Nova’s answer"}
              </div>
              {result.transcript && (
                <div className="info-box">
                  <span>You said</span>
                  <strong>{result.transcript}</strong>
                </div>
              )}
              {result.type === "navigation" && (
                <div className="screens">
                  <div>
                    <span>Current screen</span>
                    <strong>{result.currentScreen}</strong>
                  </div>
                  <div className="arrow">→</div>
                  <div>
                    <span>Target</span>
                    <strong>{result.targetScreen}</strong>
                  </div>
                </div>
              )}
              <div className="answer">
                <span className="answer-label">NOVA’S ANSWER</span>
                <div>{result.answer}</div>
              </div>
              <AnswerDetails presentation={result.presentation} />
              {result.type === "navigation" && result.steps?.length > 0 && (
                <div className="steps">
                  <h3>Step by step</h3>
                  {result.steps?.map((step, index) => (
                    <div className="step" key={`${step.action}-${index}`}>
                      <div className="step-number">{index + 1}</div>
                      <div className="step-content">
                        <strong>{step.instruction}</strong>
                        {step.location && <span>{step.location}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
      </div>
    </div>
  );
}

export default App;
