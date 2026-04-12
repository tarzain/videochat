"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

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
    <main className="min-h-screen bg-[#202124] text-foreground">
      <section className="mx-auto flex min-h-screen w-full max-w-[1680px] flex-col p-2 md:p-4">
        <div className="relative flex min-h-[calc(100vh-1rem)] flex-1 overflow-hidden rounded-[24px] border border-white/10 bg-[#111317] shadow-[0_12px_48px_rgba(0,0,0,0.28)] md:min-h-[calc(100vh-2rem)]">
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0))]" />

          <div
            className={cn(
              "relative flex min-h-full min-w-0 flex-1 flex-col transition-[width] duration-300 ease-out",
              historyDrawerOpen && "md:max-w-[calc(100%-390px)]",
            )}
          >
            <header className="absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-4 px-4 py-4 md:px-6 md:py-5">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#2b2d31] text-lg font-semibold text-white">
                  G
                </div>
                <div className="min-w-0">
                  <div className="text-[13px] font-medium uppercase tracking-[0.18em] text-white/45">
                    Gemini Live
                  </div>
                  <h1 className="truncate text-2xl font-medium text-white md:text-[2rem]">
                    AI Assistant
                  </h1>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Badge
                  className={cn(
                    "rounded-full border border-white/10 px-3 py-1 capitalize text-white shadow-none",
                    status === "connected"
                      ? "bg-[#1e3a2d]"
                      : status === "error"
                        ? "bg-[#4a2323]"
                        : "bg-[#2a2d33]",
                  )}
                >
                  {status}
                </Badge>
                <Button
                  className="rounded-full border-white/10 bg-[#2a2d33] text-white shadow-none hover:bg-[#32353b]"
                  onClick={() => setHistoryDrawerOpen((current) => !current)}
                  type="button"
                  variant="outline"
                >
                  {historyDrawerOpen ? "Hide history" : "Show history"}
                </Button>
              </div>
            </header>

            <div className="relative flex min-h-[440px] flex-1 items-stretch overflow-hidden px-3 pb-52 pt-24 md:px-5 md:pb-52 md:pt-24">
              <div className="flex min-w-0 flex-1 gap-4 md:gap-5">
              {stageVisual.kind === "image" ? (
                <div className="relative min-w-0 flex-1 overflow-hidden rounded-[20px] border border-white/10 bg-[#1a1c20]">
                  <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-4 py-4 md:px-5">
                    <div className="flex items-center gap-2 rounded-full bg-black/40 px-3 py-1.5 text-sm text-white">
                      <ImageIcon className="size-4" />
                      {stageVisual.isPreview ? "AI preview" : "AI presenting"}
                    </div>
                    <div className="hidden text-sm text-white/55 md:block">{statusDetail}</div>
                  </div>
                  <div className="flex h-full w-full items-center justify-center bg-[#16181c] p-4 md:p-8">
                    <img
                      alt="AI presentation"
                      className="max-h-full max-w-full rounded-[12px] object-contain"
                      src={stageVisual.imageUrl}
                    />
                  </div>
                </div>
              ) : (
                <AiIdleStage
                  connected={connected}
                  subtitle={stageVisual.subtitle}
                  title={stageVisual.title}
                />
              )}

                <aside className="hidden w-[220px] shrink-0 flex-col gap-3 lg:flex">
                  <ParticipantTile
                    active={stageVisual.kind === "image"}
                    label={stageVisual.kind === "image" ? "Presenting" : connected ? "In call" : "Standby"}
                    title="AI Assistant"
                  >
                    {stageVisual.kind === "image" ? (
                      <div className="flex h-full items-center justify-center bg-[#1b1d21] p-3">
                        <img
                          alt="AI presentation preview"
                          className="max-h-full max-w-full rounded-lg object-contain"
                          src={stageVisual.imageUrl}
                        />
                      </div>
                    ) : (
                      <div className="flex h-full items-center justify-center bg-[#181a1f]">
                        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#2a2d33] text-2xl text-white/80">
                          G
                        </div>
                      </div>
                    )}
                  </ParticipantTile>
                  <ParticipantTile
                    active={cameraEnabled}
                    label="You"
                    title={cameraEnabled ? "Camera on" : "Camera off"}
                  >
                    {cameraEnabled && userPreviewStream ? (
                      <LocalVideoPreview stream={userPreviewStream} />
                    ) : (
                      <div className="flex h-full items-center justify-center bg-[#181a1f] text-sm text-white/50">
                        Camera off
                      </div>
                    )}
                  </ParticipantTile>
                </aside>
              </div>

              {cameraEnabled ? (
                <div className="absolute bottom-24 right-4 z-20 w-[148px] md:bottom-28 md:right-6 md:w-[184px] lg:hidden">
                  <LocalPreviewTile
                    permissionState={permissions.camera}
                    stream={userPreviewStream}
                  />
                </div>
              ) : null}

              {activeCaption ? (
                <div className="pointer-events-none absolute bottom-36 left-1/2 z-20 w-[min(92vw,760px)] -translate-x-1/2 px-3 md:bottom-40">
                  <div className="mx-auto rounded-2xl bg-[rgba(0,0,0,0.72)] px-4 py-3 text-center text-base leading-7 text-white shadow-none md:text-lg">
                    <span className="font-medium text-white/80">AI Assistant:</span>{" "}
                    {activeCaption}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-56 bg-[linear-gradient(180deg,rgba(17,19,23,0),rgba(17,19,23,0.88)_42%,#111317_100%)]" />

            <div className="absolute inset-x-0 bottom-0 z-20 p-3 md:p-5">
              <div className="mx-auto flex w-full max-w-[980px] flex-col gap-3">
                <Suggestions className="justify-center">
                  {SUGGESTIONS.map((suggestion) => (
                    <Suggestion
                      className="border-white/10 bg-[#1a1c20] text-white/78 shadow-none hover:bg-[#202329]"
                      disabled={!connected}
                      key={suggestion}
                      onClick={sendSuggestion}
                      suggestion={suggestion}
                    />
                  ))}
                </Suggestions>

                <div className="rounded-[22px] border border-white/10 bg-[#15171b] p-3 shadow-none md:p-4">
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <Button
                      className="rounded-full border-0 bg-[#2f8099] text-white shadow-none hover:bg-[#3b90ab]"
                      disabled={connectionBusy || connected}
                      onClick={connect}
                      type="button"
                    >
                      <WifiIcon className="size-4" />
                      Connect
                    </Button>
                    <Button
                      className="rounded-full border-white/10 bg-[#0f1114] text-white shadow-none hover:bg-[#17191d]"
                      disabled={connectionBusy || !connected}
                      onClick={disconnect}
                      type="button"
                      variant="outline"
                    >
                      <WifiOffIcon className="size-4" />
                      Disconnect
                    </Button>
                    <Button
                      className="rounded-full border-0 shadow-none"
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
                      className="rounded-full border-0 shadow-none"
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
                      className="rounded-full border-white/10 bg-[#0f1114] text-white shadow-none hover:bg-[#17191d]"
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
                      className="rounded-full border-white/10 bg-[#0f1114] text-white shadow-none hover:bg-[#17191d]"
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
                </div>
              </div>
            </div>
          </div>

          <div
            className={cn(
              "absolute inset-y-0 right-0 z-30 flex w-full max-w-[390px] min-w-0 flex-col border-l border-white/10 bg-[#111317] shadow-[0_0_0_1px_rgba(255,255,255,0.02)] transition-transform duration-300 ease-out md:static md:z-0 md:w-[390px] md:max-w-[390px] md:shrink-0",
              historyDrawerOpen ? "translate-x-0" : "translate-x-full md:w-0 md:max-w-0 md:translate-x-0 md:border-l-0 md:opacity-0",
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
                className="rounded-full border-white/10 bg-[#202329] text-white hover:bg-[#2a2d33]"
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

            <div className="border-t border-white/10 p-4">
              <PromptInput
                className="rounded-[18px] border border-white/10 bg-[#101216] shadow-none"
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
                    <Badge className="rounded-full border border-white/10 bg-[#1c1f24] px-3 py-1 text-white/70 hover:bg-[#1c1f24]">
                      Mic {permissionLabel(permissions.microphone)}
                    </Badge>
                    <Badge className="rounded-full border border-white/10 bg-[#1c1f24] px-3 py-1 text-white/70 hover:bg-[#1c1f24]">
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
    <div className="relative flex h-full min-w-0 flex-1 items-center justify-center overflow-hidden rounded-[20px] border border-white/10 bg-[#17191d]">
      <div className="absolute inset-0">
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),transparent_22%),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(0deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:auto,28px_28px,28px_28px]" />
      </div>

      <div className="relative mx-auto flex max-w-2xl flex-col items-center gap-6 px-6 text-center">
        <div className="flex h-24 w-24 items-center justify-center rounded-full bg-[#22252a]">
          <div className="relative flex h-14 w-14 items-center justify-center">
            <div className="absolute inset-0 rounded-full border border-white/10" />
            <div className="h-4 w-4 rounded-full bg-white/90" />
          </div>
        </div>
        <div className="space-y-3">
          <Badge className="rounded-full border border-white/10 bg-[#22252a] px-3 py-1 text-white/70 hover:bg-[#22252a]">
            {connected ? "In call" : "Standby"}
          </Badge>
          <h2 className="text-3xl font-medium tracking-tight text-white md:text-5xl">
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

function ParticipantTile({
  active,
  children,
  label,
  title,
}: {
  active: boolean;
  children: ReactNode;
  label: string;
  title: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-[18px] border bg-[#17191d]",
        active ? "border-[#7baaf7]" : "border-white/10",
      )}
    >
      <div className="aspect-[4/3] overflow-hidden bg-[#1a1c20]">{children}</div>
      <div className="flex items-center justify-between px-3 py-2 text-sm text-white">
        <span>{label}</span>
        <span className="text-xs text-white/50">{title}</span>
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
    <div className="overflow-hidden rounded-[18px] border border-[#7baaf7] bg-[#17191d] shadow-none">
      <div className="aspect-[4/5] overflow-hidden bg-black">
        {stream ? (
          <LocalVideoPreview stream={stream} />
        ) : (
          <div className="flex h-full items-center justify-center bg-[#181a1f] px-4 text-center text-sm text-white/55">
            {permissionState === "denied"
              ? "Camera access denied"
              : "Starting local camera preview"}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between px-3 py-2 text-sm text-white">
        <span>You</span>
        <span className="text-xs text-white/55">Camera</span>
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
