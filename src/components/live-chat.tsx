"use client";

import { useEffect, useRef, useState } from "react";

import { GeminiLiveClient } from "@/lib/live-client";
import type {
  LivePermissionsState,
  LiveSessionStatus,
  TranscriptEntry,
} from "@/lib/live-types";

const INITIAL_PERMISSIONS: LivePermissionsState = {
  microphone: "unknown",
  camera: "unknown",
};

export function LiveChat() {
  const clientRef = useRef<GeminiLiveClient | null>(null);
  const [status, setStatus] = useState<LiveSessionStatus>("disconnected");
  const [statusDetail, setStatusDetail] = useState("Ready to connect.");
  const [permissions, setPermissions] =
    useState<LivePermissionsState>(INITIAL_PERMISSIONS);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [textInput, setTextInput] = useState("");
  const [inputMode, setInputMode] = useState<"continuous" | "push-to-talk">(
    "continuous",
  );
  const [microphoneEnabled, setMicrophoneEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [pushToTalkActive, setPushToTalkActive] = useState(false);

  useEffect(() => {
    const client = new GeminiLiveClient({
      onStatusChange: (nextStatus, detail) => {
        setStatus(nextStatus);
        setStatusDetail(detail ?? detailForStatus(nextStatus));
      },
      onTranscriptEntry: (entry) => {
        setTranscript((current) => [...current, entry].slice(-80));
      },
      onPermissionsChange: (nextPermissions) => {
        setPermissions(nextPermissions);
      },
    });

    clientRef.current = client;

    return () => {
      void client.destroy();
      clientRef.current = null;
    };
  }, []);

  const connect = async () => {
    await clientRef.current?.connect();
    setInputMode(clientRef.current?.getCurrentMode() ?? "continuous");
  };

  const disconnect = async () => {
    await clientRef.current?.disconnect();
  };

  const sendText = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = textInput.trim();

    if (!trimmed) {
      return;
    }

    setTextInput("");
    await clientRef.current?.sendText(trimmed);
  };

  const toggleMicrophone = () => {
    const nextValue = !microphoneEnabled;
    setMicrophoneEnabled(nextValue);
    clientRef.current?.setMicrophoneEnabled(nextValue);
  };

  const toggleCamera = async () => {
    const nextValue = !cameraEnabled;
    setCameraEnabled(nextValue);
    await clientRef.current?.setCameraEnabled(nextValue);
  };

  const switchMode = (nextMode: "continuous" | "push-to-talk") => {
    setInputMode(nextMode);
    clientRef.current?.setInputMode(nextMode);
    if (nextMode === "continuous") {
      setPushToTalkActive(false);
      clientRef.current?.setPushToTalkActive(false);
    }
  };

  const handlePushToTalk = (active: boolean) => {
    setPushToTalkActive(active);
    clientRef.current?.setPushToTalkActive(active);
  };

  const connectionBusy = status === "connecting" || status === "disconnecting";
  const connected = status === "connected";

  return (
    <main className="live-shell">
      <section className="hero-card">
        <div className="hero-copy">
          <span className="eyebrow">Next.js + Gemini Live</span>
          <h1>Realtime voice chat with optional camera input and server tools.</h1>
          <p>
            The browser connects directly to Gemini Live with short-lived
            ephemeral tokens from Next.js. Mic input streams as PCM, camera is
            opt-in, audio plays back in the page, and tool calls route through a
            server endpoint.
          </p>
        </div>

        <div className="status-grid">
          <StatusPill label="Session" value={status} tone={statusTone(status)} />
          <StatusPill
            label="Mic Permission"
            value={permissions.microphone}
            tone={permissionTone(permissions.microphone)}
          />
          <StatusPill
            label="Camera Permission"
            value={permissions.camera}
            tone={permissionTone(permissions.camera)}
          />
          <StatusPill label="Mode" value={inputMode} tone="neutral" />
        </div>

        <p className="status-detail">{statusDetail}</p>
      </section>

      <section className="workspace-grid">
        <div className="panel controls-panel">
          <div className="panel-header">
            <h2>Controls</h2>
            <span>Mic-first. Camera is optional.</span>
          </div>

          <div className="button-row">
            <button
              className="button button-primary"
              disabled={connectionBusy || connected}
              onClick={connect}
              type="button"
            >
              Connect
            </button>
            <button
              className="button"
              disabled={connectionBusy || !connected}
              onClick={disconnect}
              type="button"
            >
              Disconnect
            </button>
          </div>

          <div className="button-row">
            <button
              className={`button ${microphoneEnabled ? "button-active" : ""}`}
              disabled={!connected}
              onClick={toggleMicrophone}
              type="button"
            >
              {microphoneEnabled ? "Mute Mic" : "Unmute Mic"}
            </button>
            <button
              className={`button ${cameraEnabled ? "button-active" : ""}`}
              disabled={!connected}
              onClick={() => void toggleCamera()}
              type="button"
            >
              {cameraEnabled ? "Stop Camera" : "Start Camera"}
            </button>
          </div>

          <div className="mode-toggle">
            <button
              className={`button ${inputMode === "continuous" ? "button-active" : ""}`}
              disabled={!connected}
              onClick={() => switchMode("continuous")}
              type="button"
            >
              Continuous
            </button>
            <button
              className={`button ${inputMode === "push-to-talk" ? "button-active" : ""}`}
              disabled={!connected}
              onClick={() => switchMode("push-to-talk")}
              type="button"
            >
              Push To Talk
            </button>
          </div>

          <button
            className={`button push-to-talk ${pushToTalkActive ? "button-active" : ""}`}
            disabled={!connected || inputMode !== "push-to-talk"}
            onMouseDown={() => handlePushToTalk(true)}
            onMouseLeave={() => handlePushToTalk(false)}
            onMouseUp={() => handlePushToTalk(false)}
            onTouchEnd={() => handlePushToTalk(false)}
            onTouchStart={() => handlePushToTalk(true)}
            type="button"
          >
            Hold To Talk
          </button>

          <div className="note-card">
            <h3>Demo tool</h3>
            <p>
              Ask the assistant for the current time in a timezone like
              <code> Europe/London</code> or <code> America/Los_Angeles</code>.
            </p>
          </div>
        </div>

        <div className="panel transcript-panel">
          <div className="panel-header">
            <h2>Transcript</h2>
            <span>Model speech, user turns, and tool events.</span>
          </div>

          <div className="transcript-list">
            {transcript.length === 0 ? (
              <div className="empty-state">
                Connect the session, unlock audio playback with that click, and
                start talking.
              </div>
            ) : (
              transcript.map((entry) => (
                <article className={`transcript-entry role-${entry.role}`} key={entry.id}>
                  <header>
                    <strong>{entry.role}</strong>
                    <span>{new Date(entry.timestamp).toLocaleTimeString()}</span>
                  </header>
                  <p>{entry.text}</p>
                </article>
              ))
            )}
          </div>

          <form className="composer" onSubmit={sendText}>
            <textarea
              onChange={(event) => setTextInput(event.target.value)}
              placeholder="Optional text input for the live session"
              rows={3}
              value={textInput}
            />
            <button className="button button-primary" disabled={!connected} type="submit">
              Send Text
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}

function detailForStatus(status: LiveSessionStatus): string {
  switch (status) {
    case "connecting":
      return "Requesting an ephemeral token and opening the live session.";
    case "connected":
      return "Session live. Gemini audio output is routed to your speakers.";
    case "disconnecting":
      return "Tearing down media tracks and closing the socket.";
    case "error":
      return "The last operation failed. Check the transcript for details.";
    default:
      return "Ready to connect.";
  }
}

function permissionTone(permission: LivePermissionsState[keyof LivePermissionsState]) {
  if (permission === "granted") {
    return "success";
  }

  if (permission === "denied") {
    return "danger";
  }

  return "neutral";
}

function statusTone(status: LiveSessionStatus) {
  if (status === "connected") {
    return "success";
  }

  if (status === "error") {
    return "danger";
  }

  return "neutral";
}

function StatusPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "success" | "danger" | "neutral";
}) {
  return (
    <div className={`status-pill status-pill-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
