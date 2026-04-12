"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import {
  PromptInput,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GeminiLiveClient } from "@/lib/live-client";
import { cn } from "@/lib/utils";
import type {
  LivePermissionsState,
  LiveSessionStatus,
  TranscriptEntry,
} from "@/lib/live-types";
import type { ChatStatus } from "ai";
import {
  AudioLinesIcon,
  MicIcon,
  MicOffIcon,
  VideoIcon,
  VideoOffIcon,
  WifiIcon,
  WifiOffIcon,
} from "lucide-react";

const INITIAL_PERMISSIONS: LivePermissionsState = {
  microphone: "unknown",
  camera: "unknown",
};

const SUGGESTIONS = [
  "What time is it in Tokyo?",
  "Summarize what you see from my camera.",
  "Help me brainstorm a landing page headline.",
  "Walk me through a React state bug.",
];

export function LiveChat() {
  const clientRef = useRef<GeminiLiveClient | null>(null);
  const [status, setStatus] = useState<LiveSessionStatus>("disconnected");
  const [statusDetail, setStatusDetail] = useState("Ready to connect.");
  const [permissions, setPermissions] =
    useState<LivePermissionsState>(INITIAL_PERMISSIONS);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [draft, setDraft] = useState("");
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
        setTranscript((current) => [...current, entry].slice(-120));
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

  const connected = status === "connected";
  const connectionBusy = status === "connecting" || status === "disconnecting";
  const submitStatus: ChatStatus =
    status === "error"
      ? "error"
      : connectionBusy
        ? "submitted"
        : "ready";

  const statusTone = useMemo(() => {
    if (status === "connected") {
      return "bg-emerald-500/12 text-emerald-200";
    }

    if (status === "error") {
      return "bg-red-500/12 text-red-200";
    }

    return "bg-secondary text-secondary-foreground";
  }, [status]);

  const connect = async () => {
    await clientRef.current?.connect();
    setInputMode(clientRef.current?.getCurrentMode() ?? "continuous");
  };

  const disconnect = async () => {
    await clientRef.current?.disconnect();
  };

  const sendPrompt = async (message: PromptInputMessage) => {
    const trimmed = message.text.trim();

    if (!trimmed) {
      return;
    }

    setDraft("");
    await clientRef.current?.sendText(trimmed);
  };

  const sendSuggestion = async (suggestion: string) => {
    setDraft("");
    await clientRef.current?.sendText(suggestion);
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

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-6 lg:py-8">
      <section className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="flex flex-col gap-4 rounded-3xl border border-border/80 bg-card/80 p-5 shadow-2xl shadow-black/20 backdrop-blur">
          <div className="space-y-3">
            <Badge className="rounded-full bg-primary/14 px-3 py-1 text-primary hover:bg-primary/14">
              Gemini Live + AI Elements
            </Badge>
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight">
                Voice-first Gemini chat with tools and optional camera input.
              </h1>
              <p className="text-sm leading-6 text-muted-foreground">
                Browser media streams directly to Gemini Live through ephemeral
                tokens. Text, tool calls, and session state render through AI
                Elements conversation primitives.
              </p>
            </div>
          </div>

          <div className="grid gap-2">
            <StatusRow label="Session">
              <Badge className={cn("rounded-full px-3 py-1 capitalize", statusTone)}>
                {status}
              </Badge>
            </StatusRow>
            <StatusRow label="Mic Permission">
              <PermissionBadge value={permissions.microphone} />
            </StatusRow>
            <StatusRow label="Camera Permission">
              <PermissionBadge value={permissions.camera} />
            </StatusRow>
            <StatusRow label="Mode">
              <Badge className="rounded-full bg-secondary px-3 py-1 capitalize text-secondary-foreground">
                {inputMode}
              </Badge>
            </StatusRow>
          </div>

          <p className="rounded-2xl border border-border/70 bg-background/30 px-4 py-3 text-sm leading-6 text-muted-foreground">
            {statusDetail}
          </p>

          <div className="grid gap-2">
            <Button
              className="justify-start"
              disabled={connectionBusy || connected}
              onClick={connect}
              type="button"
            >
              <WifiIcon className="size-4" />
              Connect
            </Button>
            <Button
              className="justify-start"
              disabled={connectionBusy || !connected}
              onClick={disconnect}
              type="button"
              variant="outline"
            >
              <WifiOffIcon className="size-4" />
              Disconnect
            </Button>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
            <Button
              className="justify-start"
              disabled={!connected}
              onClick={toggleMicrophone}
              type="button"
              variant={microphoneEnabled ? "secondary" : "outline"}
            >
              {microphoneEnabled ? (
                <MicIcon className="size-4" />
              ) : (
                <MicOffIcon className="size-4" />
              )}
              {microphoneEnabled ? "Mute mic" : "Unmute mic"}
            </Button>
            <Button
              className="justify-start"
              disabled={!connected}
              onClick={() => void toggleCamera()}
              type="button"
              variant={cameraEnabled ? "secondary" : "outline"}
            >
              {cameraEnabled ? (
                <VideoIcon className="size-4" />
              ) : (
                <VideoOffIcon className="size-4" />
              )}
              {cameraEnabled ? "Stop camera" : "Start camera"}
            </Button>
          </div>

          <div className="grid gap-2">
            <div className="grid grid-cols-2 gap-2">
              <Button
                disabled={!connected}
                onClick={() => switchMode("continuous")}
                type="button"
                variant={inputMode === "continuous" ? "secondary" : "outline"}
              >
                Continuous
              </Button>
              <Button
                disabled={!connected}
                onClick={() => switchMode("push-to-talk")}
                type="button"
                variant={inputMode === "push-to-talk" ? "secondary" : "outline"}
              >
                Push to talk
              </Button>
            </div>
            <Button
              className="justify-start"
              disabled={!connected || inputMode !== "push-to-talk"}
              onMouseDown={() => handlePushToTalk(true)}
              onMouseLeave={() => handlePushToTalk(false)}
              onMouseUp={() => handlePushToTalk(false)}
              onTouchEnd={() => handlePushToTalk(false)}
              onTouchStart={() => handlePushToTalk(true)}
              type="button"
              variant={pushToTalkActive ? "default" : "outline"}
            >
              <AudioLinesIcon className="size-4" />
              {pushToTalkActive ? "Listening now" : "Hold to talk"}
            </Button>
          </div>

          <div className="rounded-2xl border border-border/70 bg-background/30 px-4 py-3 text-sm text-muted-foreground">
            Ask for the current time in a timezone like{" "}
            <code className="font-mono text-foreground">Europe/London</code> to
            exercise the demo server-side tool.
          </div>
        </aside>

        <section className="flex min-h-[70vh] flex-col overflow-hidden rounded-3xl border border-border/80 bg-card/75 shadow-2xl shadow-black/20 backdrop-blur">
          <div className="border-b border-border/80 px-4 py-3 md:px-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-medium">Conversation</h2>
                <p className="text-sm text-muted-foreground">
                  User turns, Gemini responses, and live tool activity.
                </p>
              </div>
              <Badge className="rounded-full bg-background/60 px-3 py-1 text-muted-foreground hover:bg-background/60">
                {transcript.length} events
              </Badge>
            </div>

            <Suggestions>
              {SUGGESTIONS.map((suggestion) => (
                <Suggestion
                  disabled={!connected}
                  key={suggestion}
                  onClick={sendSuggestion}
                  suggestion={suggestion}
                />
              ))}
            </Suggestions>
          </div>

          <div className="min-h-0 flex-1">
            <Conversation className="h-full">
              <ConversationContent className="gap-5 p-4 md:p-5">
                {transcript.length === 0 ? (
                  <ConversationEmptyState
                    description="Connect the session to unlock audio playback, then start talking or type into the prompt input below."
                    title="No live turns yet"
                  />
                ) : (
                  transcript.map((entry) => {
                    if (entry.tool) {
                      return (
                        <Message from="assistant" key={entry.id}>
                          <MessageContent className="w-full max-w-2xl">
                            <div className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                              Tool
                            </div>
                            <Tool defaultOpen={entry.tool.state !== "output-available"}>
                              <ToolHeader
                                state={entry.tool.state}
                                title={entry.tool.name}
                                toolName={entry.tool.name}
                                type="dynamic-tool"
                              />
                              <ToolContent>
                                {entry.tool.input !== undefined ? (
                                  <ToolInput input={entry.tool.input} />
                                ) : null}
                                <ToolOutput
                                  errorText={entry.tool.errorText}
                                  output={entry.tool.output}
                                />
                              </ToolContent>
                            </Tool>
                          </MessageContent>
                        </Message>
                      );
                    }

                    return (
                      <Message
                        from={entry.role === "user" ? "user" : "assistant"}
                        key={entry.id}
                      >
                        <div className="space-y-2">
                          {entry.role !== "user" ? (
                            <div className="px-1 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                              {entry.role}
                            </div>
                          ) : null}
                          <MessageContent>
                            <MessageResponse>{entry.text}</MessageResponse>
                          </MessageContent>
                          <div className="px-1 text-[11px] text-muted-foreground">
                            {new Date(entry.timestamp).toLocaleTimeString()}
                          </div>
                        </div>
                      </Message>
                    );
                  })
                )}
              </ConversationContent>
              <ConversationScrollButton />
            </Conversation>
          </div>

          <div className="border-t border-border/80 p-4 md:p-5">
            <PromptInput
              onSubmit={(message) => void sendPrompt(message)}
              onError={() => undefined}
            >
              <PromptInputBody>
                <PromptInputTextarea
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={
                    connected
                      ? "Type a text turn for the live session"
                      : "Connect first to send a prompt"
                  }
                  value={draft}
                />
              </PromptInputBody>
              <PromptInputFooter>
                <PromptInputTools>
                  <PromptInputButton
                    disabled={!connected}
                    onClick={toggleMicrophone}
                    type="button"
                    variant={microphoneEnabled ? "secondary" : "ghost"}
                  >
                    {microphoneEnabled ? (
                      <MicIcon className="size-4" />
                    ) : (
                      <MicOffIcon className="size-4" />
                    )}
                    Mic
                  </PromptInputButton>
                  <PromptInputButton
                    disabled={!connected}
                    onClick={() => void toggleCamera()}
                    type="button"
                    variant={cameraEnabled ? "secondary" : "ghost"}
                  >
                    {cameraEnabled ? (
                      <VideoIcon className="size-4" />
                    ) : (
                      <VideoOffIcon className="size-4" />
                    )}
                    Camera
                  </PromptInputButton>
                  <PromptInputButton
                    disabled={!connected}
                    onClick={() =>
                      switchMode(
                        inputMode === "continuous" ? "push-to-talk" : "continuous",
                      )
                    }
                    type="button"
                    variant="ghost"
                  >
                    <AudioLinesIcon className="size-4" />
                    {inputMode === "continuous" ? "Continuous" : "Push"}
                  </PromptInputButton>
                </PromptInputTools>
                <PromptInputSubmit
                  disabled={!connected || !draft.trim()}
                  status={submitStatus}
                />
              </PromptInputFooter>
            </PromptInput>
          </div>
        </section>
      </section>
    </main>
  );
}

function detailForStatus(status: LiveSessionStatus): string {
  switch (status) {
    case "connecting":
      return "Requesting an ephemeral token and opening the Gemini Live session.";
    case "connected":
      return "Session live. Audio output is unlocked and streaming to your speakers.";
    case "disconnecting":
      return "Closing the live socket and tearing down local media tracks.";
    case "error":
      return "The last live action failed. Check the latest conversation event.";
    default:
      return "Ready to connect.";
  }
}

function StatusRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-background/25 px-4 py-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function PermissionBadge({
  value,
}: {
  value: LivePermissionsState[keyof LivePermissionsState];
}) {
  const className =
    value === "granted"
      ? "bg-emerald-500/12 text-emerald-200"
      : value === "denied"
        ? "bg-red-500/12 text-red-200"
        : "bg-secondary text-secondary-foreground";

  return (
    <Badge className={cn("rounded-full px-3 py-1 capitalize", className)}>
      {value}
    </Badge>
  );
}
