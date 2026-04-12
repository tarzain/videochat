"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import {
  PromptInput,
  PromptInputBody,
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
import { ScrollArea } from "@/components/ui/scroll-area";
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
  ImageIcon,
  MicIcon,
  MicOffIcon,
  VideoIcon,
  VideoOffIcon,
  WifiIcon,
  WifiOffIcon,
  XIcon,
} from "lucide-react";

const INITIAL_PERMISSIONS: LivePermissionsState = {
  microphone: "unknown",
  camera: "unknown",
};

const SUGGESTIONS = [
  "Generate a poster of a moonlit tea shop.",
  "Summarize what you see from my camera.",
  "What time is it in Tokyo?",
];

type AiStageVisual =
  | {
      kind: "idle";
      title: string;
      subtitle: string;
    }
  | {
      kind: "image";
      title: string;
      subtitle: string;
      imageUrl: string;
      isPreview: boolean;
    };

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
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [userPreviewStream, setUserPreviewStream] = useState<MediaStream | null>(
    null,
  );

  useEffect(() => {
    const client = new GeminiLiveClient({
      onStatusChange: (nextStatus, detail) => {
        setStatus(nextStatus);
        setStatusDetail(detail ?? detailForStatus(nextStatus));
      },
      onTranscriptEntry: (entry) => {
        setTranscript((current) => [...current, entry].slice(-180));
      },
      onPermissionsChange: (nextPermissions) => {
        setPermissions(nextPermissions);
      },
      onCameraStreamChange: (stream) => {
        setUserPreviewStream(stream);
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

  const stageVisual = useMemo<AiStageVisual>(() => {
    const latestImageEntry = [...transcript]
      .reverse()
      .find((entry) => entry.tool?.imageUrl);

    if (latestImageEntry?.tool?.imageUrl) {
      const outputStatus =
        Boolean(
          latestImageEntry.tool.output &&
            typeof latestImageEntry.tool.output === "object" &&
            "status" in latestImageEntry.tool.output &&
            latestImageEntry.tool.output.status === "preview",
        );

      return {
        kind: "image",
        imageUrl: latestImageEntry.tool.imageUrl,
        isPreview: outputStatus,
        title: outputStatus ? "AI Assistant is presenting" : "AI Assistant presented",
        subtitle: outputStatus
          ? "Flux preview image"
          : "Latest generated image on stage",
      };
    }

    const imageStatusEntry = [...transcript].reverse().find((entry) => {
      if (entry.role !== "system" || entry.kind !== "status") {
        return false;
      }

      return /image generation/i.test(entry.text);
    });

    return {
      kind: "idle",
      title: connected ? "AI Assistant is live" : "AI Assistant camera is off",
      subtitle: imageStatusEntry?.text ?? "Waiting to speak or present something visual.",
    };
  }, [connected, transcript]);

  const historyEntries = useMemo(() => groupTranscriptEntries(transcript), [transcript]);

  const activeCaption = useMemo(() => {
    return [...historyEntries]
      .reverse()
      .find((entry) => entry.role === "model" && entry.kind === "text")
      ?.text;
  }, [historyEntries]);

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
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#222a3a_0%,#0b0d12_42%,#050608_100%)] text-foreground">
      <section className="mx-auto flex min-h-screen w-full max-w-[1600px] flex-col p-3 md:p-5">
        <div className="relative flex min-h-[calc(100vh-1.5rem)] flex-1 overflow-hidden rounded-[32px] border border-white/10 bg-[#0b0d12] shadow-[0_30px_120px_rgba(0,0,0,0.45)] md:min-h-[calc(100vh-2.5rem)]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(64,130,255,0.16),transparent_30%),radial-gradient(circle_at_top_right,rgba(255,221,128,0.14),transparent_28%),linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0))]" />

          <div className="relative flex min-h-full flex-1 flex-col">
            <header className="absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-4 p-4 md:p-6">
              <div className="space-y-2">
                <Badge className="rounded-full bg-white/10 px-3 py-1 text-white hover:bg-white/10">
                  Gemini Live Call
                </Badge>
                <div>
                  <h1 className="text-2xl font-semibold tracking-tight text-white md:text-3xl">
                    AI Assistant
                  </h1>
                  <p className="text-sm text-white/70">{statusDetail}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Badge
                  className={cn(
                    "rounded-full px-3 py-1 capitalize text-white",
                    status === "connected"
                      ? "bg-emerald-500/20"
                      : status === "error"
                        ? "bg-red-500/20"
                        : "bg-white/10",
                  )}
                >
                  {status}
                </Badge>
                <Button
                  className="rounded-full border-white/15 bg-white/10 text-white hover:bg-white/15"
                  onClick={() => setHistoryDrawerOpen((current) => !current)}
                  type="button"
                  variant="outline"
                >
                  {historyDrawerOpen ? "Hide history" : "Show history"}
                </Button>
              </div>
            </header>

            <div className="relative flex min-h-[440px] flex-1 items-center justify-center overflow-hidden px-4 pb-52 pt-28 md:px-6 md:pb-56 md:pt-32">
              {stageVisual.kind === "image" ? (
                <div className="relative h-full w-full overflow-hidden rounded-[28px] border border-white/10 bg-black/50 shadow-2xl">
                  <div
                    aria-hidden="true"
                    className="absolute inset-0 bg-cover bg-center"
                    style={{ backgroundImage: `url(${stageVisual.imageUrl})` }}
                  />
                  <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(4,6,10,0.22),rgba(4,6,10,0.05)_40%,rgba(4,6,10,0.42))]" />
                  <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full bg-black/55 px-3 py-1.5 text-sm text-white backdrop-blur md:left-5 md:top-5">
                    <ImageIcon className="size-4" />
                    {stageVisual.isPreview ? "AI preview" : "AI presenting"}
                  </div>
                </div>
              ) : (
                <AiIdleStage
                  connected={connected}
                  subtitle={stageVisual.subtitle}
                  title={stageVisual.title}
                />
              )}

              <div className="absolute bottom-24 right-4 z-20 w-[160px] md:bottom-28 md:right-6 md:w-[220px]">
                {cameraEnabled ? (
                  <LocalPreviewTile
                    permissionState={permissions.camera}
                    stream={userPreviewStream}
                  />
                ) : null}
              </div>

              {activeCaption ? (
                <div className="pointer-events-none absolute bottom-40 left-1/2 z-20 w-[min(92vw,820px)] -translate-x-1/2 px-3 md:bottom-44">
                  <div className="mx-auto rounded-2xl border border-white/10 bg-black/68 px-4 py-3 text-center text-base leading-7 text-white shadow-xl backdrop-blur md:text-lg">
                    <span className="font-medium text-white/80">AI Assistant:</span>{" "}
                    {activeCaption}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-64 bg-[linear-gradient(180deg,rgba(11,13,18,0),rgba(11,13,18,0.82)_45%,rgba(11,13,18,0.98))]" />

            <div className="absolute inset-x-0 bottom-0 z-20 p-3 md:p-5">
              <div className="mx-auto flex w-full max-w-[1040px] flex-col gap-3">
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

                <div className="rounded-[28px] border border-white/10 bg-black/55 p-3 shadow-2xl backdrop-blur-xl md:p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      className="rounded-full"
                      disabled={connectionBusy || connected}
                      onClick={connect}
                      type="button"
                    >
                      <WifiIcon className="size-4" />
                      Connect
                    </Button>
                    <Button
                      className="rounded-full"
                      disabled={connectionBusy || !connected}
                      onClick={disconnect}
                      type="button"
                      variant="outline"
                    >
                      <WifiOffIcon className="size-4" />
                      Disconnect
                    </Button>
                    <Button
                      className="rounded-full"
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
                      {microphoneEnabled ? "Mic on" : "Mic off"}
                    </Button>
                    <Button
                      className="rounded-full"
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
                      {cameraEnabled ? "Camera on" : "Camera off"}
                    </Button>
                    <Button
                      className="rounded-full"
                      disabled={!connected}
                      onClick={() =>
                        switchMode(
                          inputMode === "continuous" ? "push-to-talk" : "continuous",
                        )
                      }
                      type="button"
                      variant="outline"
                    >
                      <AudioLinesIcon className="size-4" />
                      {inputMode === "continuous" ? "Continuous" : "Push to talk"}
                    </Button>
                    <Button
                      className="rounded-full"
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

                  <PromptInput
                    className="mt-3 rounded-[24px] border border-white/10 bg-white/5"
                    onError={() => undefined}
                    onSubmit={(message) => void sendPrompt(message)}
                  >
                    <PromptInputBody>
                      <PromptInputTextarea
                        className="text-white placeholder:text-white/45"
                        onChange={(event) => setDraft(event.target.value)}
                        placeholder={
                          connected
                            ? "Send a text prompt into the live call"
                            : "Connect first to send a prompt"
                        }
                        value={draft}
                      />
                    </PromptInputBody>
                    <PromptInputFooter>
                      <PromptInputTools>
                        <Badge className="rounded-full bg-white/10 px-3 py-1 text-white/80 hover:bg-white/10">
                          Mic {permissionLabel(permissions.microphone)}
                        </Badge>
                        <Badge className="rounded-full bg-white/10 px-3 py-1 text-white/80 hover:bg-white/10">
                          Camera {permissionLabel(permissions.camera)}
                        </Badge>
                      </PromptInputTools>
                      <PromptInputSubmit
                        disabled={!connected || !draft.trim()}
                        status={submitStatus}
                      />
                    </PromptInputFooter>
                  </PromptInput>
                </div>
              </div>
            </div>
          </div>

          <div
            className={cn(
              "absolute inset-y-0 right-0 z-30 flex w-full max-w-[390px] min-w-0 flex-col border-l border-white/10 bg-[#0d1016]/95 shadow-2xl backdrop-blur-2xl transition-transform duration-300 ease-out md:w-[390px]",
              historyDrawerOpen ? "translate-x-0" : "translate-x-full",
            )}
          >
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-4">
              <div>
                <h2 className="text-lg font-semibold text-white">Call history</h2>
                <p className="text-sm text-white/60">
                  Transcript, tool activity, and system events
                </p>
              </div>
              <Button
                className="rounded-full border-white/15 bg-white/10 text-white hover:bg-white/15"
                onClick={() => setHistoryDrawerOpen(false)}
                type="button"
                variant="outline"
              >
                <XIcon className="size-4" />
              </Button>
            </div>

            <ScrollArea className="min-h-0 flex-1">
              <div className="min-w-0 space-y-4 overflow-x-hidden p-4 [&_code]:break-words [&_pre]:break-words [&_pre]:whitespace-pre-wrap">
                {historyEntries.length === 0 ? (
                  <div className="rounded-3xl border border-dashed border-white/10 bg-white/5 p-5 text-sm leading-6 text-white/60">
                    Connect the session to start the call. Transcript and tool
                    history will appear here while the main stage stays focused
                    on the live experience.
                  </div>
                ) : (
                  historyEntries.map((entry) => {
                    if (entry.tool) {
                      return (
                        <div
                          className="w-full max-w-full min-w-0 overflow-hidden rounded-3xl border border-white/10 bg-white/[0.04] p-3"
                          key={entry.id}
                        >
                          <div className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-white/50">
                            Tool
                          </div>
                          {entry.tool.imageUrl ? (
                            <div className="mb-3 overflow-hidden rounded-2xl border border-white/10 bg-black/50">
                              <div className="flex aspect-square w-full items-center justify-center bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.06),transparent_40%),rgba(0,0,0,0.22)] p-3">
                                <img
                                  alt="Generated result"
                                  className="max-h-full w-full rounded-xl object-contain"
                                  src={entry.tool.imageUrl}
                                />
                              </div>
                            </div>
                          ) : null}
                          <Tool
                            className="w-full max-w-full min-w-0 overflow-hidden"
                            defaultOpen={entry.tool.state !== "output-available"}
                          >
                            <ToolHeader
                              state={entry.tool.state}
                              title={entry.tool.name}
                              toolName={entry.tool.name}
                              type="dynamic-tool"
                            />
                            <ToolContent className="w-full max-w-full min-w-0">
                              {entry.tool.input !== undefined ? (
                                <ToolInput
                                  className="w-full max-w-full min-w-0"
                                  input={entry.tool.input}
                                />
                              ) : null}
                              <ToolOutput
                                className="w-full max-w-full min-w-0"
                                errorText={entry.tool.errorText}
                                output={entry.tool.output}
                              />
                            </ToolContent>
                          </Tool>
                          <div className="mt-2 text-[11px] text-white/45">
                            {new Date(entry.timestamp).toLocaleTimeString()}
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div
                        className={cn(
                          "w-full max-w-full min-w-0 overflow-hidden rounded-3xl border p-3",
                          entry.role === "model"
                            ? "border-white/10 bg-white/[0.06]"
                            : entry.role === "user"
                              ? "border-sky-400/15 bg-sky-400/[0.08]"
                              : "border-white/8 bg-white/[0.03]",
                        )}
                        key={entry.id}
                      >
                        <div className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-white/50">
                          {entry.role}
                        </div>
                        <div className="max-w-full break-words text-sm leading-6 text-white/86">
                          {entry.text}
                        </div>
                        <div className="mt-2 text-[11px] text-white/45">
                          {new Date(entry.timestamp).toLocaleTimeString()}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </ScrollArea>
          </div>

          {historyDrawerOpen ? (
            <button
              aria-label="Close history drawer"
              className="absolute inset-0 z-20 bg-black/35 md:hidden"
              onClick={() => setHistoryDrawerOpen(false)}
              type="button"
            />
          ) : null}
        </div>
      </section>
    </main>
  );
}

function AiIdleStage({
  connected,
  subtitle,
  title,
}: {
  connected: boolean;
  subtitle: string;
  title: string;
}) {
  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_top,rgba(120,166,255,0.22),transparent_28%),linear-gradient(160deg,#131722_0%,#0b0d12_45%,#06070a_100%)] shadow-2xl">
      <div className="absolute inset-0">
        <div className="absolute left-[8%] top-[14%] size-48 rounded-full bg-sky-400/18 blur-3xl animate-pulse" />
        <div className="absolute right-[10%] top-[18%] size-56 rounded-full bg-amber-300/14 blur-3xl animate-pulse [animation-delay:800ms]" />
        <div className="absolute bottom-[10%] left-1/2 size-72 -translate-x-1/2 rounded-full bg-blue-500/12 blur-3xl animate-pulse [animation-delay:1400ms]" />
      </div>

      <div className="relative mx-auto flex max-w-2xl flex-col items-center gap-6 px-6 text-center">
        <div className="flex h-28 w-28 items-center justify-center rounded-full border border-white/12 bg-white/6 shadow-[0_0_80px_rgba(90,145,255,0.18)]">
          <div className="relative flex h-16 w-16 items-center justify-center">
            <div className="absolute inset-0 rounded-full border border-white/10" />
            <div className="absolute inset-2 rounded-full border border-white/12" />
            <div className="h-6 w-6 rounded-full bg-white shadow-[0_0_40px_rgba(255,255,255,0.65)]" />
          </div>
        </div>
        <div className="space-y-3">
          <Badge className="rounded-full bg-white/10 px-3 py-1 text-white/75 hover:bg-white/10">
            {connected ? "In call" : "Standby"}
          </Badge>
          <h2 className="text-3xl font-semibold tracking-tight text-white md:text-5xl">
            {title}
          </h2>
          <p className="mx-auto max-w-xl text-sm leading-7 text-white/65 md:text-base">
            {subtitle}
          </p>
        </div>
      </div>
    </div>
  );
}

function LocalPreviewTile({
  permissionState,
  stream,
}: {
  permissionState: LivePermissionsState["camera"];
  stream: MediaStream | null;
}) {
  return (
    <div className="overflow-hidden rounded-[24px] border border-white/15 bg-black/65 shadow-2xl backdrop-blur-xl">
      <div className="aspect-[4/5] overflow-hidden bg-black">
        {stream ? (
          <LocalVideoPreview stream={stream} />
        ) : (
          <div className="flex h-full items-center justify-center bg-[linear-gradient(180deg,#161a22,#090b0f)] px-4 text-center text-sm text-white/55">
            {permissionState === "denied"
              ? "Camera access denied"
              : "Starting local camera preview"}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between px-3 py-2 text-sm text-white">
        <span>You</span>
        <span className="text-xs text-white/55">Local preview</span>
      </div>
    </div>
  );
}

function LocalVideoPreview({ stream }: { stream: MediaStream }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;

    if (!video) {
      return;
    }

    video.srcObject = stream;
    void video.play().catch(() => undefined);

    return () => {
      if (video.srcObject === stream) {
        video.srcObject = null;
      }
    };
  }, [stream]);

  return (
    <video
      className="h-full w-full object-cover [transform:scaleX(-1)]"
      muted
      playsInline
      ref={videoRef}
    />
  );
}

function permissionLabel(value: LivePermissionsState[keyof LivePermissionsState]) {
  switch (value) {
    case "granted":
      return "granted";
    case "denied":
      return "denied";
    default:
      return "unknown";
  }
}

function isPreviewToolEntry(entry: TranscriptEntry): boolean {
  return Boolean(
    entry.tool?.imageUrl &&
      entry.tool.output &&
      typeof entry.tool.output === "object" &&
      "status" in entry.tool.output &&
      entry.tool.output.status === "preview",
  );
}

function mergeTurnText(previous: string, next: string): string {
  const trimmedPrevious = previous.trim();
  const trimmedNext = next.trim();

  if (!trimmedPrevious) {
    return trimmedNext;
  }

  if (!trimmedNext) {
    return trimmedPrevious;
  }

  if (trimmedPrevious === trimmedNext) {
    return trimmedPrevious;
  }

  if (trimmedNext.includes(trimmedPrevious)) {
    return trimmedNext;
  }

  if (trimmedPrevious.includes(trimmedNext)) {
    return trimmedPrevious;
  }

  return `${trimmedPrevious}\n\n${trimmedNext}`;
}

function canMergeTextEntries(previous: TranscriptEntry, next: TranscriptEntry): boolean {
  return (
    previous.kind === "text" &&
    next.kind === "text" &&
    previous.role === next.role &&
    !previous.tool &&
    !next.tool
  );
}

function isImageGenerationStatusEntry(entry: TranscriptEntry): boolean {
  return (
    entry.role === "system" &&
    entry.kind === "status" &&
    /image generation/i.test(entry.text)
  );
}

function groupTranscriptEntries(entries: TranscriptEntry[]): TranscriptEntry[] {
  const grouped: TranscriptEntry[] = [];

  for (const entry of entries) {
    if (isPreviewToolEntry(entry) || isImageGenerationStatusEntry(entry)) {
      continue;
    }

    const lastEntry = grouped[grouped.length - 1];

    if (lastEntry && canMergeTextEntries(lastEntry, entry)) {
      lastEntry.text = mergeTurnText(lastEntry.text, entry.text);
      lastEntry.timestamp = entry.timestamp;
      continue;
    }

    grouped.push({
      ...entry,
      tool: entry.tool
        ? {
            ...entry.tool,
          }
        : undefined,
    });
  }

  return grouped;
}

function detailForStatus(status: LiveSessionStatus): string {
  switch (status) {
    case "connecting":
      return "Requesting an ephemeral token and opening the Gemini Live session.";
    case "connected":
      return "Session live. Audio output is unlocked and the AI can present generated visuals.";
    case "disconnecting":
      return "Closing the live socket and tearing down local media tracks.";
    case "error":
      return "The last live action failed. Open history for the most recent event.";
    default:
      return "Ready to connect.";
  }
}
