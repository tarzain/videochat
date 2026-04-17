"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtImage,
  ChainOfThoughtStep,
} from "@/components/ai-elements/chain-of-thought";
import { CodeBlock } from "@/components/ai-elements/code-block";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GeminiLiveClient } from "@/lib/live-client";
import { LTX_STREAM_SETTINGS, useLtxStreamSession } from "@/lib/ltx-stream";
import { cn } from "@/lib/utils";
import type {
  ImageModelPreset,
  LivePermissionsState,
  LiveSessionStatus,
  StreamTarget,
  TranscriptEntry,
} from "@/lib/live-types";
import type { ChatStatus } from "ai";
import {
  ImageIcon,
  CheckCircleIcon,
  MessageSquareIcon,
  MicIcon,
  MicOffIcon,
  MonitorPlay,
  MonitorUp,
  MonitorX,
  PhoneIcon,
  PhoneOffIcon,
  VideoIcon,
  VideoOffIcon,
  WrenchIcon,
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
  const streamPresentationEnabledRef = useRef(false);
  const [status, setStatus] = useState<LiveSessionStatus>("disconnected");
  const [permissions, setPermissions] =
    useState<LivePermissionsState>(INITIAL_PERMISSIONS);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [draft, setDraft] = useState("");
  const [microphoneEnabled, setMicrophoneEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [imageModelPreset, setImageModelPreset] = useState<ImageModelPreset>("flux");
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [streamPresentationEnabled, setStreamPresentationEnabled] = useState(false);
  const [selectedStageEntryId, setSelectedStageEntryId] = useState<string | null>(null);
  const [userPreviewStream, setUserPreviewStream] = useState<MediaStream | null>(
    null,
  );
  const [preparedStageStreamTarget, setPreparedStageStreamTarget] =
    useState<StreamTarget | null>(null);

  useEffect(() => {
    streamPresentationEnabledRef.current = streamPresentationEnabled;
  }, [streamPresentationEnabled]);

  useEffect(() => {
    const client = new GeminiLiveClient({
      onStatusChange: (nextStatus) => {
        setStatus(nextStatus);
      },
      onTranscriptEntry: (entry) => {
        setTranscript((current) => [...current, entry].slice(-180));

        if (
          streamPresentationEnabledRef.current &&
          entry.tool?.imageUrl &&
          isFinalGenerateImageEntry(entry)
        ) {
          setSelectedStageEntryId(entry.id);
        }
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

  useEffect(() => {
    clientRef.current?.setImageModelPreset(imageModelPreset);
  }, [imageModelPreset]);

  const connected = status === "connected";
  const connectionBusy = status === "connecting" || status === "disconnecting";
  const submitStatus: ChatStatus =
    status === "error"
      ? "error"
      : connectionBusy
        ? "submitted"
        : "ready";

  const latestFinalImageEntry = useMemo(
    () =>
      [...transcript]
        .reverse()
        .find((entry) => entry.tool?.imageUrl && isFinalGenerateImageEntry(entry)) ?? null,
    [transcript],
  );

  const latestImageEntry = useMemo(
    () => [...transcript].reverse().find((entry) => entry.tool?.imageUrl) ?? null,
    [transcript],
  );

  const selectedStageEntry = useMemo(
    () =>
      selectedStageEntryId
        ? transcript.find((entry) => entry.id === selectedStageEntryId) ?? null
        : null,
    [selectedStageEntryId, transcript],
  );

  const stageDisplayEntry =
    streamPresentationEnabled && selectedStageEntry ? selectedStageEntry : latestImageEntry;

  const stageVisual = useMemo<AiStageVisual>(() => {
    if (stageDisplayEntry?.tool?.imageUrl) {
      const outputStatus =
        Boolean(
          stageDisplayEntry.tool.output &&
            typeof stageDisplayEntry.tool.output === "object" &&
            "status" in stageDisplayEntry.tool.output &&
            stageDisplayEntry.tool.output.status === "preview",
        );

      return {
        kind: "image",
        imageUrl: stageDisplayEntry.tool.imageUrl,
        isPreview: outputStatus,
        title: outputStatus ? "vidi is presenting" : "vidi presented",
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
      title: connected ? "vidi is live" : "vidi camera is off",
      subtitle: imageStatusEntry?.text ?? "Waiting to speak or present something visual.",
    };
  }, [connected, stageDisplayEntry, transcript]);

  const streamSourceEntry = selectedStageEntry;

  const canEnableStageStream = Boolean(selectedStageEntry ?? latestFinalImageEntry);
  const desiredStageStreamTarget = useMemo(() => {
    return streamSourceEntry ? buildDesiredStageStreamTarget(streamSourceEntry) : null;
  }, [streamSourceEntry]);

  useEffect(() => {
    let cancelled = false;

    const prepare = async () => {
      if (!streamPresentationEnabled || !desiredStageStreamTarget?.imageUrl) {
        setPreparedStageStreamTarget(null);
        return;
      }

      try {
        const imageDataUrl = await imageUrlToDataUrl(desiredStageStreamTarget.imageUrl);

        if (cancelled) {
          return;
        }

        setPreparedStageStreamTarget({
          key: desiredStageStreamTarget.key,
          imageDataUrl,
          prompt: desiredStageStreamTarget.prompt,
          width: desiredStageStreamTarget.width,
          height: desiredStageStreamTarget.height,
          frameRate: desiredStageStreamTarget.frameRate,
          numFrames: desiredStageStreamTarget.numFrames,
          maxSegments: desiredStageStreamTarget.maxSegments,
          loopyStrategy: desiredStageStreamTarget.loopyStrategy,
          position: desiredStageStreamTarget.position,
        });
      } catch (error) {
        if (cancelled) {
          return;
        }

        console.error("[videochat] Unable to prepare stream image:", error);
        setPreparedStageStreamTarget(null);
      }
    };

    void prepare();

    return () => {
      cancelled = true;
    };
  }, [
    streamPresentationEnabled,
    desiredStageStreamTarget?.key,
    desiredStageStreamTarget?.prompt,
    desiredStageStreamTarget?.imageUrl,
    desiredStageStreamTarget?.width,
    desiredStageStreamTarget?.height,
    desiredStageStreamTarget?.frameRate,
    desiredStageStreamTarget?.numFrames,
    desiredStageStreamTarget?.maxSegments,
    desiredStageStreamTarget?.loopyStrategy,
    desiredStageStreamTarget?.position,
  ]);

  const {
    disconnect: disconnectStageStream,
    status: stageStreamStatus,
    mediaSurfaceMode: stageMediaSurfaceMode,
    videoRef: stageStreamVideoRef,
  } = useLtxStreamSession({
    enabled:
      LTX_STREAM_SETTINGS.enabled &&
      streamPresentationEnabled &&
      canEnableStageStream,
    target: preparedStageStreamTarget,
  });

  const historyEntries = useMemo(() => groupTranscriptEntries(transcript), [transcript]);

  const activeCaption = useMemo(() => {
    return [...historyEntries]
      .reverse()
      .find((entry) => entry.role === "model" && entry.kind === "text")
      ?.text;
  }, [historyEntries]);

  const shouldMountStageVideo =
    stageVisual.kind === "image" && !stageVisual.isPreview && canEnableStageStream;
  const stageVideoVisible =
    shouldMountStageVideo &&
    streamPresentationEnabled &&
    stageMediaSurfaceMode === "stream";
  const stageImageVisible = stageVisual.kind === "image" && !stageVideoVisible;
  const stageStreamToggleState =
    stageStreamStatus === "connecting" || stageStreamStatus === "waiting_for_first_chunk"
      ? "loading"
      : streamPresentationEnabled && stageStreamStatus === "playing" && stageVideoVisible
        ? "on"
        : "off";
  const stageStreamToggleLabel =
    stageStreamToggleState === "loading"
      ? "Connecting to Live Video Stream"
      : stageStreamToggleState === "on"
        ? "Disconnect from Live Video Stream"
        : "Connect to Live Video Stream";
  const StageStreamToggleIcon =
    stageStreamToggleState === "loading"
      ? MonitorUp
      : stageStreamToggleState === "on"
        ? MonitorX
        : MonitorPlay;

  const connect = async () => {
    await clientRef.current?.connect();
    clientRef.current?.setInputMode("continuous");
  };

  const ensureConnected = async () => {
    if (status === "connected") {
      return true;
    }

    if (status === "connecting" || status === "disconnecting") {
      return false;
    }

    await connect();
    return true;
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
    const ready = await ensureConnected();

    if (!ready) {
      setDraft(trimmed);
      return;
    }

    await clientRef.current?.sendText(trimmed);
  };

  const sendSuggestion = async (suggestion: string) => {
    setDraft("");
    const ready = await ensureConnected();

    if (!ready) {
      setDraft(suggestion);
      return;
    }

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

  const toggleImageModelPreset = () => {
    setImageModelPreset((current) =>
      current === "flux" ? "nano-banana" : "flux",
    );
  };

  const toggleStageStream = () => {
    if (!canEnableStageStream) {
      return;
    }

    if (streamPresentationEnabled || stageStreamToggleState === "loading") {
      disconnectStageStream();
      setPreparedStageStreamTarget(null);
      setStreamPresentationEnabled(false);
      return;
    }

    setSelectedStageEntryId(latestFinalImageEntry?.id ?? null);
    setStreamPresentationEnabled(true);
  };

  return (
    <main className="h-screen overflow-hidden bg-[var(--call-shell-bg)] text-[var(--call-fg)]">
      <section className="flex h-full w-full flex-col overflow-hidden">
        <div className="relative flex h-full min-h-0 flex-1 overflow-hidden bg-[var(--call-shell-bg)]">
          <div
            className={cn(
              "relative flex min-h-full min-w-0 flex-1 flex-col transition-[width] duration-300 ease-out",
              historyDrawerOpen && "md:max-w-[calc(100%-390px)]",
            )}
          >
            <header className="absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-4 px-4 py-4 md:px-6 md:py-5">
              <div className="flex items-center gap-3">
                <div className="text-[1.65rem] font-medium tracking-tight text-[var(--call-fg)]">
                  vidi
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  aria-label={historyDrawerOpen ? "Hide history" : "Show history"}
                  className="h-11 w-11 rounded-full border-[var(--call-border)] bg-[var(--call-button-neutral)] p-0 text-[var(--call-fg)] shadow-none hover:bg-[var(--call-button-neutral-hover)]"
                  onClick={() => setHistoryDrawerOpen((current) => !current)}
                  size="icon"
                  title={historyDrawerOpen ? "Hide chat history" : "Open chat history"}
                  type="button"
                  variant="outline"
                >
                  <MessageSquareIcon className="size-5" />
                </Button>
              </div>
            </header>

            <div className="absolute inset-x-0 top-0 bottom-0 flex items-stretch overflow-hidden px-3 pb-52 pt-24 md:px-5 md:pb-52 md:pt-24">
              <div className="flex min-h-0 min-w-0 flex-1 gap-4 md:gap-5">
              {stageVisual.kind === "image" ? (
                <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[20px] border border-[var(--call-border)] bg-[var(--call-panel)]">
                  <div className="relative z-10 flex items-center justify-start px-4 py-4 md:px-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex items-center gap-2 rounded-full bg-[var(--call-chip-bg)] px-3 py-1.5 text-sm text-[var(--call-chip-fg)]">
                        <ImageIcon className="size-4" />
                        {stageVisual.isPreview ? "vidi preview" : "vidi presenting"}
                      </div>
                      {!stageVisual.isPreview ? (
                        <Button
                          className="h-9 rounded-full border-[var(--call-border)] bg-[var(--call-button-neutral)] px-3 text-[var(--call-fg)] shadow-none hover:bg-[var(--call-button-neutral-hover)]"
                          disabled={!canEnableStageStream}
                          aria-label={stageStreamToggleLabel}
                          onClick={toggleStageStream}
                          type="button"
                          variant="outline"
                        >
                          <StageStreamToggleIcon className="mr-2 size-4" />
                          {stageStreamToggleLabel}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex min-h-0 flex-1 items-center justify-center p-4 md:p-8">
                    {shouldMountStageVideo ? (
                      <div className="relative flex h-full max-h-full w-full max-w-full items-center justify-center">
                        <video
                          className={cn(
                            "absolute inset-0 h-full w-full rounded-[12px] object-contain transition-opacity duration-300",
                            stageVideoVisible ? "opacity-100" : "pointer-events-none opacity-0",
                          )}
                          muted
                          playsInline
                          ref={stageStreamVideoRef}
                        />
                        <img
                          alt="vidi presentation"
                          className={cn(
                            "h-full max-h-full w-full max-w-full rounded-[12px] object-contain transition-opacity duration-300",
                            stageImageVisible ? "opacity-100" : "pointer-events-none opacity-0",
                          )}
                          src={stageVisual.imageUrl}
                        />
                      </div>
                    ) : (
                      <img
                        alt="vidi presentation"
                        className="h-full max-h-full w-full max-w-full rounded-[12px] object-contain"
                        src={stageVisual.imageUrl}
                      />
                    )}
                  </div>
                </div>
              ) : (
                <AiIdleStage
                  connected={connected}
                  subtitle={stageVisual.subtitle}
                  title={stageVisual.title}
                />
              )}

                <aside className="hidden h-full min-h-0 w-[220px] shrink-0 flex-col gap-3 lg:flex">
                  <ParticipantTile
                    active={stageVisual.kind === "image"}
                    label={stageVisual.kind === "image" ? "Presenting" : connected ? "In call" : "Standby"}
                    title="vidi"
                  >
                    {stageVisual.kind === "image" ? (
                      <div className="flex h-full min-h-0 items-center justify-center p-3">
                        <img
                          alt="vidi presentation preview"
                          className="h-full max-h-full w-full max-w-full rounded-lg object-contain"
                          src={stageVisual.imageUrl}
                        />
                      </div>
                    ) : (
                      <div className="flex h-full items-center justify-center bg-[var(--call-panel-muted)]">
                        <div className="text-xl font-medium tracking-tight text-[var(--call-fg-soft)]">
                          vidi
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
                      <div className="flex h-full items-center justify-center bg-[var(--call-panel-muted)] text-sm text-[var(--call-fg-muted)]">
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
                <div className="pointer-events-none absolute bottom-36 left-1/2 z-20 w-[min(94vw,1080px)] -translate-x-1/2 px-3 md:bottom-40">
                  <div className="mx-auto rounded-2xl bg-[var(--call-caption-bg)] px-4 py-3 text-center text-base leading-7 text-[var(--call-fg)] shadow-none md:text-lg">
                    <span className="font-medium text-[var(--call-caption-label)]">vidi:</span>{" "}
                    {activeCaption}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-56 bg-[linear-gradient(180deg,var(--call-gradient-top),var(--call-gradient-mid)_42%,var(--call-gradient-bottom)_100%)]" />

            <div className="absolute inset-x-0 bottom-0 z-20 p-3 md:p-5">
              <div className="mx-auto flex w-full max-w-[980px] flex-col gap-3">
                <Suggestions className="justify-center">
                  {SUGGESTIONS.map((suggestion) => (
                    <Suggestion
                      className="border-[var(--call-border)] bg-[var(--call-panel)] text-[var(--call-fg-soft)] shadow-none hover:bg-[var(--call-panel-strong)]"
                      disabled={!connected}
                      key={suggestion}
                      onClick={sendSuggestion}
                      suggestion={suggestion}
                    />
                  ))}
                </Suggestions>

                <div className="rounded-[22px] border border-[var(--call-border)] bg-[var(--call-dock-bg)] p-3 shadow-none md:p-4">
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <Button
                      className={cn(
                        "h-12 w-12 rounded-full border-0 p-0 text-[var(--primary-foreground)] shadow-none",
                        connected
                          ? "bg-[var(--call-button-danger)] hover:bg-[var(--call-button-danger-hover)]"
                          : "bg-[var(--call-button-active)] hover:bg-[var(--call-button-active-hover)]",
                      )}
                      disabled={connectionBusy}
                      onClick={connected ? disconnect : connect}
                      size="icon"
                      type="button"
                      aria-label={connected ? "Hang up" : "Start call"}
                    >
                      {connected ? (
                        <PhoneOffIcon className="size-5" />
                      ) : (
                        <PhoneIcon className="size-5" />
                      )}
                    </Button>
                    <Button
                      className={cn(
                        "h-12 w-12 rounded-full border-0 p-0 shadow-none",
                        microphoneEnabled
                          ? "bg-[var(--call-button-active)] text-[var(--primary-foreground)] hover:bg-[var(--call-button-active-hover)]"
                          : "bg-[var(--call-button-neutral)] text-[var(--call-fg)] hover:bg-[var(--call-button-neutral-hover)]",
                      )}
                      disabled={!connected}
                      onClick={toggleMicrophone}
                      size="icon"
                      type="button"
                      aria-label={microphoneEnabled ? "Mute microphone" : "Unmute microphone"}
                    >
                      {microphoneEnabled ? (
                        <MicIcon className="size-5" />
                      ) : (
                        <MicOffIcon className="size-5" />
                      )}
                    </Button>
                    <Button
                      className={cn(
                        "h-12 w-12 rounded-full border-0 p-0 shadow-none",
                        cameraEnabled
                          ? "bg-[var(--call-button-active)] text-[var(--primary-foreground)] hover:bg-[var(--call-button-active-hover)]"
                          : "bg-[var(--call-button-neutral)] text-[var(--call-fg)] hover:bg-[var(--call-button-neutral-hover)]",
                      )}
                      disabled={!connected}
                      onClick={() => void toggleCamera()}
                      size="icon"
                      type="button"
                      aria-label={cameraEnabled ? "Turn camera off" : "Turn camera on"}
                    >
                      {cameraEnabled ? (
                        <VideoIcon className="size-5" />
                      ) : (
                        <VideoOffIcon className="size-5" />
                      )}
                    </Button>
                    <Button
                      aria-label={
                        imageModelPreset === "flux"
                          ? "Switch image generation to HQ mode"
                          : "Switch image generation to Draft mode"
                      }
                      className={cn(
                        "h-12 rounded-full border-0 px-4 text-sm font-medium shadow-none",
                        imageModelPreset === "flux"
                          ? "bg-[var(--call-button-neutral)] text-[var(--call-fg)] hover:bg-[var(--call-button-neutral-hover)]"
                          : "bg-[var(--call-button-active)] text-[var(--primary-foreground)] hover:bg-[var(--call-button-active-hover)]",
                      )}
                      onClick={toggleImageModelPreset}
                      title={
                        imageModelPreset === "flux"
                          ? "Draft mode uses Flux"
                          : "HQ mode uses Nano Banana 2"
                      }
                      type="button"
                    >
                      {imageModelPreset === "flux" ? "Draft" : "HQ"}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div
            className={cn(
              "absolute inset-y-0 right-0 z-30 flex w-full max-w-[390px] min-w-0 flex-col border-l border-[var(--call-border)] bg-[var(--call-shell-bg)] shadow-[0_0_0_1px_var(--call-tool-card)] transition-transform duration-300 ease-out md:static md:z-0 md:w-[390px] md:max-w-[390px] md:shrink-0",
              historyDrawerOpen ? "translate-x-0" : "translate-x-full md:w-0 md:max-w-0 md:translate-x-0 md:border-l-0 md:opacity-0",
            )}
          >
            <div className="flex items-center justify-between border-b border-[var(--call-border)] px-4 py-4">
              <div>
                <h2 className="text-lg font-semibold text-[var(--call-fg)]">Call history</h2>
                <p className="text-sm text-[var(--call-fg-muted)]">
                  Transcript, tool activity, and system events
                </p>
              </div>
              <Button
                className="rounded-full border-[var(--call-border)] bg-[var(--call-button-neutral)] text-[var(--call-fg)] hover:bg-[var(--call-button-neutral-hover)]"
                onClick={() => setHistoryDrawerOpen(false)}
                type="button"
                variant="outline"
              >
                <XIcon className="size-4" />
              </Button>
            </div>

            <Conversation className="min-h-0 flex-1">
              <ConversationContent className="min-w-0 gap-4 overflow-x-hidden p-4 [&_code]:break-words [&_pre]:break-words [&_pre]:whitespace-pre-wrap">
                {historyEntries.length === 0 ? (
                  <ConversationEmptyState
                    className="rounded-3xl border border-dashed border-[var(--call-border)] bg-[var(--call-history-empty)] p-5 text-left text-sm leading-6 text-[var(--call-fg-muted)]"
                    description="Transcript and tool history will appear here while the main stage stays focused on the live experience."
                    title="Connect the session to start the call."
                  />
                ) : (
                  historyEntries.map((entry) => {
                    if (entry.tool) {
                      if (isGenerateImageChainEntry(entry)) {
                        return (
                          <GenerateImageChainEntry entry={entry} key={entry.id} />
                        );
                      }

                      return <GenericToolChainEntry entry={entry} key={entry.id} />;
                    }

                    return (
                      <div
                        className={cn(
                          "min-w-0 overflow-hidden p-3",
                          entry.role === "model"
                            ? "w-full max-w-full border-transparent bg-transparent"
                            : entry.role === "user"
                              ? "ml-auto w-fit max-w-full rounded-3xl border border-[var(--call-user-border)] bg-[var(--call-user-bg)]"
                              : "w-full max-w-full border-transparent bg-transparent",
                        )}
                        key={entry.id}
                      >
                        <div className="max-w-full break-words text-sm leading-6 text-[var(--call-fg)]">
                          {entry.text}
                        </div>
                        <div className="mt-2 text-[11px] text-[var(--call-fg-muted)]">
                          {new Date(entry.timestamp).toLocaleTimeString()}
                        </div>
                      </div>
                    );
                  })
                )}
              </ConversationContent>
              <ConversationScrollButton
                className="bottom-4 left-1/2 z-10 h-10 w-10 -translate-x-1/2 rounded-full border-[var(--call-border)] bg-[var(--call-panel)] text-[var(--call-fg)] shadow-none hover:bg-[var(--call-button-neutral-hover)]"
              />
            </Conversation>

            <div className="border-t border-[var(--call-border)] p-4">
              <PromptInput
                className="rounded-[18px] border border-[var(--call-border)] bg-[var(--call-panel)] shadow-none"
                onError={() => undefined}
                onSubmit={(message) => void sendPrompt(message)}
              >
                <PromptInputBody>
                  <PromptInputTextarea
                    className="text-[var(--call-fg)] placeholder:text-[var(--call-fg-muted)]"
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder="Send a text prompt into the live call"
                    value={draft}
                  />
                </PromptInputBody>
                <PromptInputFooter className="justify-end">
                  <PromptInputSubmit
                    disabled={connectionBusy || !draft.trim()}
                    status={submitStatus}
                  />
                </PromptInputFooter>
              </PromptInput>
            </div>
          </div>

          {historyDrawerOpen ? (
            <button
              aria-label="Close history drawer"
              className="absolute inset-0 z-20 bg-[var(--call-overlay)] md:hidden"
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
    <div className="relative flex h-full min-w-0 flex-1 items-center justify-center overflow-hidden rounded-[20px] border border-[var(--call-border)] bg-[var(--call-panel)]">
      <div className="absolute inset-0">
        <div className="absolute inset-0 bg-[linear-gradient(180deg,var(--call-overlay),transparent_22%),linear-gradient(90deg,var(--call-stage-grid)_1px,transparent_1px),linear-gradient(0deg,var(--call-stage-grid)_1px,transparent_1px)] bg-[size:auto,28px_28px,28px_28px]" />
      </div>

      <div className="relative mx-auto flex max-w-2xl flex-col items-center gap-6 px-6 text-center">
        <div className="flex h-24 w-24 items-center justify-center rounded-full bg-[var(--call-panel-strong)]">
          <div className="relative flex h-14 w-14 items-center justify-center">
            <div className="absolute inset-0 rounded-full border border-[var(--call-border)]" />
            <div className="h-4 w-4 rounded-full bg-[var(--call-fg)]/90" />
          </div>
        </div>
        <div className="space-y-3">
          <Badge className="rounded-full border border-[var(--call-border)] bg-[var(--call-panel-strong)] px-3 py-1 text-[var(--call-fg-soft)] hover:bg-[var(--call-panel-strong)]">
            {connected ? "In call" : "Standby"}
          </Badge>
          <h2 className="text-3xl font-medium tracking-tight text-[var(--call-fg)] md:text-5xl">
            {title}
          </h2>
          <p className="mx-auto max-w-xl text-sm leading-7 text-[var(--call-fg-muted)] md:text-base">
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
        "overflow-hidden rounded-[18px] border bg-[var(--call-panel)]",
        active ? "border-[var(--call-accent-border)]" : "border-[var(--call-border)]",
      )}
    >
      <div className="aspect-[4/3] overflow-hidden bg-[var(--call-panel-muted)]">{children}</div>
      <div className="flex items-center justify-between px-3 py-2 text-sm text-[var(--call-fg)]">
        <span>{label}</span>
        <span className="text-xs text-[var(--call-fg-muted)]">{title}</span>
      </div>
    </div>
  );
}

function GenerateImageChainEntry({ entry }: { entry: TranscriptEntry }) {
  const prompt = getGenerateImagePrompt(entry.tool?.input);
  const completed = entry.tool?.state === "output-available";

  return (
    <div className="w-full max-w-full min-w-0 overflow-hidden p-3">
      <ChainOfThought className="space-y-3" defaultOpen>
        <ChainOfThoughtHeader className="text-[var(--call-fg-soft)] hover:text-[var(--call-fg)]">
          Image generation
        </ChainOfThoughtHeader>
        <ChainOfThoughtContent className="space-y-3">
          <ChainOfThoughtStep
            className="text-[var(--call-fg)]"
            description={prompt ?? undefined}
            icon={ImageIcon}
            label={completed ? "Generated image from prompt" : "Generating image"}
            status={completed ? "complete" : "active"}
          />
          {entry.tool?.imageUrl ? (
            <ChainOfThoughtStep
              className="text-[var(--call-fg)]"
              icon={ImageIcon}
              label="Attached result"
              status="complete"
            >
              <ChainOfThoughtImage
                caption={prompt ? `Prompt: ${prompt}` : "Final generated image"}
                className="mt-0"
              >
                <img
                  alt="Generated result"
                  className="max-h-[18rem] w-full rounded-xl object-contain"
                  src={entry.tool.imageUrl}
                />
              </ChainOfThoughtImage>
            </ChainOfThoughtStep>
          ) : null}
        </ChainOfThoughtContent>
      </ChainOfThought>
      <div className="mt-2 text-[11px] text-[var(--call-fg-muted)]">
        {new Date(entry.timestamp).toLocaleTimeString()}
      </div>
    </div>
  );
}

function GenericToolChainEntry({ entry }: { entry: TranscriptEntry }) {
  const toolName = formatToolName(entry.tool?.name ?? "tool");
  const inputSummary = summarizeToolInput(entry.tool?.input);
  const completed = entry.tool?.state === "output-available";
  const failed = entry.tool?.state === "output-error";

  return (
    <div className="w-full max-w-full min-w-0 overflow-hidden p-3">
      <ChainOfThought className="space-y-3" defaultOpen>
        <ChainOfThoughtHeader className="text-[var(--call-fg-soft)] hover:text-[var(--call-fg)]">
          {toolName}
        </ChainOfThoughtHeader>
        <ChainOfThoughtContent className="space-y-3">
          <ChainOfThoughtStep
            className="text-[var(--call-fg)]"
            description={inputSummary ?? undefined}
            icon={WrenchIcon}
            label={
              completed
                ? `Called ${toolName}`
                : failed
                  ? `${toolName} failed`
                  : `Calling ${toolName}`
            }
            status={completed || failed ? "complete" : "active"}
          />
          {entry.tool?.output !== undefined || entry.tool?.errorText ? (
            <ChainOfThoughtStep
              className="text-[var(--call-fg)]"
              icon={CheckCircleIcon}
              label={failed ? "Returned error" : "Returned result"}
              status="complete"
            >
              <div className="mt-2 overflow-hidden rounded-xl border border-[var(--call-border)] bg-[var(--call-tool-card)]">
                {entry.tool?.errorText ? (
                  <div className="px-3 py-2 text-sm leading-6 text-[var(--destructive)]">
                    {entry.tool.errorText}
                  </div>
                ) : (
                  renderToolResult(entry.tool?.output)
                )}
              </div>
            </ChainOfThoughtStep>
          ) : null}
        </ChainOfThoughtContent>
      </ChainOfThought>
      <div className="mt-2 text-[11px] text-[var(--call-fg-muted)]">
        {new Date(entry.timestamp).toLocaleTimeString()}
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
    <div className="overflow-hidden rounded-[18px] border border-[var(--call-accent-border)] bg-[var(--call-panel)] shadow-none">
      <div className="aspect-[4/5] overflow-hidden bg-[var(--call-panel-muted)]">
        {stream ? (
          <LocalVideoPreview stream={stream} />
        ) : (
          <div className="flex h-full items-center justify-center bg-[var(--call-panel-muted)] px-4 text-center text-sm text-[var(--call-fg-muted)]">
            {permissionState === "denied"
              ? "Camera access denied"
              : "Starting local camera preview"}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between px-3 py-2 text-sm text-[var(--call-fg)]">
        <span>You</span>
        <span className="text-xs text-[var(--call-fg-muted)]">Camera</span>
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

function isPreviewToolEntry(entry: TranscriptEntry): boolean {
  return Boolean(
    entry.tool?.imageUrl &&
      entry.tool.output &&
      typeof entry.tool.output === "object" &&
      "status" in entry.tool.output &&
      entry.tool.output.status === "preview",
  );
}

function isFinalGenerateImageEntry(entry: TranscriptEntry): boolean {
  return Boolean(
    entry.tool?.name === "generate_image" &&
      entry.tool.imageUrl &&
      entry.tool.state === "output-available" &&
      !isPreviewToolEntry(entry),
  );
}

function formatToolName(name: string): string {
  return name.replace(/[_-]+/g, " ").trim();
}

function summarizeToolInput(input: unknown): string | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const entries = Object.entries(input)
    .filter(([, value]) => value !== undefined && value !== null && value !== false)
    .slice(0, 3)
    .map(([key, value]) => {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return `${key}: ${String(value)}`;
      }

      return key;
    });

  return entries.length > 0 ? entries.join(", ") : null;
}

function renderToolResult(output: unknown): ReactNode {
  if (output === undefined || output === null) {
    return null;
  }

  if (
    typeof output === "string" ||
    typeof output === "number" ||
    typeof output === "boolean"
  ) {
    return (
      <div className="px-3 py-2 text-sm leading-6 text-[var(--call-fg)]">
        {String(output)}
      </div>
    );
  }

  return <CodeBlock code={JSON.stringify(output, null, 2)} language="json" />;
}

function isGenerateImageChainEntry(entry: TranscriptEntry): boolean {
  return (
    entry.tool?.name === "generate_image" &&
    entry.tool.state !== "output-error"
  );
}

function canMergeToolEntries(
  previous: TranscriptEntry,
  next: TranscriptEntry,
): boolean {
  return (
    previous.kind === "tool-call" &&
    next.kind === "tool-result" &&
    previous.role === "tool" &&
    next.role === "tool" &&
    previous.tool?.name === next.tool?.name
  );
}

function mergeToolEntries(
  previous: TranscriptEntry,
  next: TranscriptEntry,
): TranscriptEntry {
  const previousTool = previous.tool!;
  const nextTool = next.tool!;

  return {
    ...previous,
    kind: next.kind,
    text: next.text || previous.text,
    timestamp: next.timestamp,
    tool: {
      ...previousTool,
      ...nextTool,
      name: nextTool.name || previousTool.name,
      state: nextTool.state || previousTool.state,
      input: nextTool.input ?? previousTool.input,
      output: nextTool.output ?? previousTool.output,
      imageUrl: nextTool.imageUrl ?? previousTool.imageUrl,
      errorText: nextTool.errorText ?? previousTool.errorText,
    },
  };
}

function getGenerateImagePrompt(input: unknown): string | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  if (!("contents" in input)) {
    return null;
  }

  const contents = input.contents;
  return typeof contents === "string" && contents.trim() ? contents.trim() : null;
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

async function imageUrlToDataUrl(imageUrl: string): Promise<string> {
  const response = await fetch(imageUrl);

  if (!response.ok) {
    throw new Error(`Image fetch failed with status ${response.status}.`);
  }

  const blob = await response.blob();

  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => {
      reject(reader.error ?? new Error("Unable to read image data."));
    };

    reader.onloadend = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("Image data URL conversion failed."));
    };

    reader.readAsDataURL(blob);
  });
}

function buildDesiredStageStreamTarget(
  entry: TranscriptEntry,
): StreamTarget & { imageUrl: string } {
  return {
    key: entry.id,
    imageDataUrl: "",
    imageUrl: entry.tool?.imageUrl ?? "",
    prompt: LTX_STREAM_SETTINGS.prompt,
    width: LTX_STREAM_SETTINGS.width,
    height: LTX_STREAM_SETTINGS.height,
    frameRate: LTX_STREAM_SETTINGS.frameRate,
    numFrames: LTX_STREAM_SETTINGS.numFrames,
    maxSegments: LTX_STREAM_SETTINGS.maxSegments,
    loopyStrategy: LTX_STREAM_SETTINGS.loopyStrategy,
    position: LTX_STREAM_SETTINGS.position,
  };
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
    if (
      entry.role === "system" ||
      isPreviewToolEntry(entry) ||
      isImageGenerationStatusEntry(entry)
    ) {
      continue;
    }

    const lastEntry = grouped[grouped.length - 1];

    if (lastEntry && canMergeToolEntries(lastEntry, entry)) {
      grouped[grouped.length - 1] = mergeToolEntries(lastEntry, entry);
      continue;
    }

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
