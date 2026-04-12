"use client";

import {
  GoogleGenAI,
  type FunctionResponse,
  type LiveServerMessage,
  type Session,
} from "@google/genai";

import type {
  LivePermissionsState,
  LiveSessionStatus,
  TokenRouteResponse,
  ToolCallRequest,
  ToolCallResponse,
  TranscriptEntry,
} from "@/lib/live-types";

type InputMode = "continuous" | "push-to-talk";

interface LiveClientHandlers {
  onStatusChange: (status: LiveSessionStatus, detail?: string) => void;
  onTranscriptEntry: (entry: TranscriptEntry) => void;
  onPermissionsChange: (permissions: LivePermissionsState) => void;
}

const INPUT_SAMPLE_RATE = 16_000;
const VIDEO_FRAME_INTERVAL_MS = 900;

function createTranscriptEntry(
  role: TranscriptEntry["role"],
  kind: TranscriptEntry["kind"],
  text: string,
): TranscriptEntry {
  return {
    id: crypto.randomUUID(),
    role,
    kind,
    text,
    timestamp: new Date().toISOString(),
  };
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

async function blobToInlineData(blob: Blob): Promise<{ mimeType: string; data: string }> {
  const bytes = new Uint8Array(await blob.arrayBuffer());

  return {
    mimeType: blob.type,
    data: uint8ArrayToBase64(bytes),
  };
}

function downsampleTo16kHz(input: Float32Array, sourceSampleRate: number): Int16Array {
  if (sourceSampleRate === INPUT_SAMPLE_RATE) {
    const pcm = new Int16Array(input.length);

    for (let index = 0; index < input.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, input[index]));
      pcm[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }

    return pcm;
  }

  const ratio = sourceSampleRate / INPUT_SAMPLE_RATE;
  const targetLength = Math.round(input.length / ratio);
  const pcm = new Int16Array(targetLength);

  let offset = 0;
  for (let index = 0; index < targetLength; index += 1) {
    const nextOffset = Math.round((index + 1) * ratio);
    let sum = 0;
    let count = 0;

    for (let cursor = offset; cursor < nextOffset && cursor < input.length; cursor += 1) {
      sum += input[cursor];
      count += 1;
    }

    const sample = Math.max(-1, Math.min(1, count > 0 ? sum / count : 0));
    pcm[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    offset = nextOffset;
  }

  return pcm;
}

function getPcmRate(mimeType?: string): number {
  const match = mimeType?.match(/rate=(\d+)/i);

  return match ? Number.parseInt(match[1], 10) : 24_000;
}

export class GeminiLiveClient {
  private readonly handlers: LiveClientHandlers;

  private session: Session | null = null;

  private outputAudioContext: AudioContext | null = null;

  private inputAudioContext: AudioContext | null = null;

  private microphoneStream: MediaStream | null = null;

  private cameraStream: MediaStream | null = null;

  private microphoneSourceNode: MediaStreamAudioSourceNode | null = null;

  private scriptProcessorNode: ScriptProcessorNode | null = null;

  private videoElement: HTMLVideoElement | null = null;

  private videoCanvas: HTMLCanvasElement | null = null;

  private videoFrameTimer: number | null = null;

  private playbackPromise = Promise.resolve();

  private activeSources = new Set<AudioBufferSourceNode>();

  private inputMode: InputMode = "continuous";

  private pushToTalkActive = false;

  private microphoneEnabled = true;

  private cameraEnabled = false;

  private disconnecting = false;

  constructor(handlers: LiveClientHandlers) {
    this.handlers = handlers;
  }

  getCurrentMode(): InputMode {
    return this.inputMode;
  }

  setInputMode(mode: InputMode): void {
    this.inputMode = mode;
  }

  setPushToTalkActive(active: boolean): void {
    this.pushToTalkActive = active;
  }

  setMicrophoneEnabled(enabled: boolean): void {
    this.microphoneEnabled = enabled;
  }

  async setCameraEnabled(enabled: boolean): Promise<void> {
    this.cameraEnabled = enabled;

    if (!this.session) {
      return;
    }

    if (enabled) {
      await this.ensureCamera();
      this.startVideoFrames();
      return;
    }

    this.stopVideoFrames();
    this.stopCamera();
    this.handlers.onPermissionsChange({
      microphone: this.microphoneStream ? "granted" : "unknown",
      camera: "unknown",
    });
  }

  async connect(): Promise<void> {
    if (this.session) {
      return;
    }

    this.disconnecting = false;
    this.handlers.onStatusChange("connecting");

    try {
      await this.ensureOutputAudioContext();

      const tokenResponse = await fetch("/api/live/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!tokenResponse.ok) {
        const payload = (await tokenResponse.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Failed to create ephemeral Gemini token.");
      }

      const { token, clientConfig } = (await tokenResponse.json()) as TokenRouteResponse;
      this.inputMode = clientConfig.defaultMode;

      const ai = new GoogleGenAI({
        apiKey: token,
        apiVersion: "v1alpha",
      });

      this.session = await ai.live.connect({
        model: clientConfig.model,
        callbacks: {
          onopen: () => {
            this.handlers.onStatusChange("connected");
            this.handlers.onTranscriptEntry(
              createTranscriptEntry("system", "status", `Connected to ${clientConfig.model}.`),
            );
          },
          onmessage: (message) => {
            void this.handleMessage(message);
          },
          onerror: (event) => {
            this.handlers.onStatusChange("error", event.message || "Live session error.");
            this.handlers.onTranscriptEntry(
              createTranscriptEntry("system", "error", event.message || "Live session error."),
            );
          },
          onclose: () => {
            const detail = this.disconnecting ? "Session closed." : "Session disconnected.";
            void this.cleanup(false);
            this.handlers.onStatusChange("disconnected", detail);
            this.handlers.onTranscriptEntry(createTranscriptEntry("system", "status", detail));
          },
        },
      });

      await this.ensureMicrophone();

      if (this.cameraEnabled) {
        await this.ensureCamera();
        this.startVideoFrames();
      }
    } catch (error) {
      await this.cleanup(true);
      this.handlers.onStatusChange(
        "error",
        error instanceof Error ? error.message : "Failed to connect to Gemini Live.",
      );
      this.handlers.onTranscriptEntry(
        createTranscriptEntry(
          "system",
          "error",
          error instanceof Error ? error.message : "Failed to connect to Gemini Live.",
        ),
      );
    }
  }

  async disconnect(): Promise<void> {
    this.disconnecting = true;
    this.handlers.onStatusChange("disconnecting");

    if (this.session) {
      this.session.close();
      return;
    }

    await this.cleanup(true);
    this.handlers.onStatusChange("disconnected");
  }

  async sendText(text: string): Promise<void> {
    const trimmed = text.trim();

    if (!trimmed || !this.session) {
      return;
    }

    this.handlers.onTranscriptEntry(createTranscriptEntry("user", "text", trimmed));
    this.session.sendClientContent({
      turns: [
        {
          role: "user",
          parts: [{ text: trimmed }],
        },
      ],
      turnComplete: true,
    });
  }

  async destroy(): Promise<void> {
    this.disconnecting = true;
    await this.cleanup(true);
  }

  private async handleMessage(message: LiveServerMessage): Promise<void> {
    if (message.serverContent?.interrupted) {
      this.stopPlayback();
      this.handlers.onTranscriptEntry(
        createTranscriptEntry("system", "status", "Model response interrupted."),
      );
    }

    const inputTranscript = message.serverContent?.inputTranscription?.text?.trim();
    if (inputTranscript) {
      this.handlers.onTranscriptEntry(createTranscriptEntry("user", "text", inputTranscript));
    }

    const outputTranscript = message.serverContent?.outputTranscription?.text?.trim();
    if (outputTranscript) {
      this.handlers.onTranscriptEntry(createTranscriptEntry("model", "text", outputTranscript));
    }

    const modelParts = message.serverContent?.modelTurn?.parts ?? [];
    for (const part of modelParts) {
      if (part.text?.trim()) {
        this.handlers.onTranscriptEntry(
          createTranscriptEntry("model", "text", part.text.trim()),
        );
      }

      if (part.inlineData?.data && part.inlineData.mimeType?.startsWith("audio/pcm")) {
        await this.queueAudio(part.inlineData.data, part.inlineData.mimeType);
      }
    }

    const functionCalls = message.toolCall?.functionCalls ?? [];
    if (functionCalls.length > 0) {
      await this.executeToolCalls(functionCalls);
    }
  }

  private async executeToolCalls(
    functionCalls: Array<{ id?: string; name?: string; args?: Record<string, unknown> }>,
  ): Promise<void> {
    if (!this.session) {
      return;
    }

    const responses: FunctionResponse[] = [];

    for (const functionCall of functionCalls) {
      const name = functionCall.name ?? "unknown_tool";
      const callId = functionCall.id ?? crypto.randomUUID();
      const request: ToolCallRequest = {
        name,
        args: functionCall.args ?? {},
        callId,
      };

      this.handlers.onTranscriptEntry(
        createTranscriptEntry(
          "tool",
          "tool-call",
          `${request.name}(${JSON.stringify(request.args)})`,
        ),
      );

      const response = await fetch("/api/live/tool", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      });

      const payload = (await response.json()) as ToolCallResponse;
      const functionResponse: FunctionResponse = {
        id: payload.callId,
        name: payload.name,
        response: payload.error ? { error: payload.error } : { output: payload.result },
      };

      responses.push(functionResponse);

      this.handlers.onTranscriptEntry(
        createTranscriptEntry(
          "tool",
          payload.error ? "error" : "tool-result",
          payload.error
            ? `${payload.name} failed: ${payload.error}`
            : `${payload.name} -> ${JSON.stringify(payload.result)}`,
        ),
      );
    }

    this.session.sendToolResponse({
      functionResponses: responses,
    });
  }

  private shouldSendAudio(): boolean {
    return (
      this.session !== null &&
      this.microphoneEnabled &&
      (this.inputMode === "continuous" || this.pushToTalkActive)
    );
  }

  private async ensureMicrophone(): Promise<void> {
    if (this.microphoneStream && this.inputAudioContext && this.scriptProcessorNode) {
      this.handlers.onPermissionsChange({
        microphone: "granted",
        camera: this.cameraStream ? "granted" : "unknown",
      });
      return;
    }

    try {
      this.microphoneStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      this.inputAudioContext = new AudioContext();
      this.microphoneSourceNode = this.inputAudioContext.createMediaStreamSource(
        this.microphoneStream,
      );
      this.scriptProcessorNode = this.inputAudioContext.createScriptProcessor(4096, 1, 1);
      this.scriptProcessorNode.onaudioprocess = (event) => {
        if (!this.shouldSendAudio() || !this.session || !this.inputAudioContext) {
          return;
        }

        const inputBuffer = event.inputBuffer.getChannelData(0);
        const pcm = downsampleTo16kHz(inputBuffer, this.inputAudioContext.sampleRate);
        const audioBytes = new Uint8Array(pcm.buffer.slice(0));

        this.session.sendRealtimeInput({
          audio: {
            mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}`,
            data: uint8ArrayToBase64(audioBytes),
          },
        });
      };

      this.microphoneSourceNode.connect(this.scriptProcessorNode);
      this.scriptProcessorNode.connect(this.inputAudioContext.destination);
      this.handlers.onPermissionsChange({
        microphone: "granted",
        camera: this.cameraStream ? "granted" : "unknown",
      });
    } catch {
      this.handlers.onPermissionsChange({
        microphone: "denied",
        camera: this.cameraStream ? "granted" : "unknown",
      });
      throw new Error("Microphone access is required to start the live session.");
    }
  }

  private async ensureCamera(): Promise<void> {
    if (this.cameraStream && this.videoElement && this.videoCanvas) {
      this.handlers.onPermissionsChange({
        microphone: this.microphoneStream ? "granted" : "unknown",
        camera: "granted",
      });
      return;
    }

    try {
      this.cameraStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 960 },
          height: { ideal: 540 },
          facingMode: "user",
        },
      });
    } catch {
      this.cameraEnabled = false;
      this.handlers.onPermissionsChange({
        microphone: this.microphoneStream ? "granted" : "unknown",
        camera: "denied",
      });
      throw new Error("Camera access was denied.");
    }

    this.videoElement = document.createElement("video");
    this.videoElement.playsInline = true;
    this.videoElement.muted = true;
    this.videoElement.srcObject = this.cameraStream;
    await this.videoElement.play();

    this.videoCanvas = document.createElement("canvas");
    this.handlers.onPermissionsChange({
      microphone: this.microphoneStream ? "granted" : "unknown",
      camera: "granted",
    });
  }

  private startVideoFrames(): void {
    if (!this.session || !this.videoElement || !this.videoCanvas || this.videoFrameTimer !== null) {
      return;
    }

    const context = this.videoCanvas.getContext("2d");
    if (!context) {
      return;
    }

    this.videoFrameTimer = window.setInterval(() => {
      if (!this.session || !this.videoElement || !this.videoCanvas) {
        return;
      }

      const width = this.videoElement.videoWidth;
      const height = this.videoElement.videoHeight;

      if (!width || !height) {
        return;
      }

      this.videoCanvas.width = width;
      this.videoCanvas.height = height;
      context.drawImage(this.videoElement, 0, 0, width, height);

      this.videoCanvas.toBlob((blob) => {
        if (!blob || !this.session || !this.cameraEnabled) {
          return;
        }

        void blobToInlineData(blob).then((inlineData) => {
          if (!this.session || !this.cameraEnabled) {
            return;
          }

          this.session.sendRealtimeInput({
            video: inlineData,
          });
        });
      }, "image/jpeg", 0.78);
    }, VIDEO_FRAME_INTERVAL_MS);
  }

  private stopVideoFrames(): void {
    if (this.videoFrameTimer !== null) {
      window.clearInterval(this.videoFrameTimer);
      this.videoFrameTimer = null;
    }
  }

  private stopCamera(): void {
    this.cameraStream?.getTracks().forEach((track) => track.stop());
    this.cameraStream = null;
    this.videoElement?.pause();
    this.videoElement = null;
    this.videoCanvas = null;
  }

  private async ensureOutputAudioContext(): Promise<void> {
    if (!this.outputAudioContext) {
      this.outputAudioContext = new AudioContext();
    }

    if (this.outputAudioContext.state === "suspended") {
      await this.outputAudioContext.resume();
    }
  }

  private async queueAudio(base64Audio: string, mimeType?: string): Promise<void> {
    const context = this.outputAudioContext;
    if (!context) {
      return;
    }

    const sampleRate = getPcmRate(mimeType);
    const pcmBytes = base64ToUint8Array(base64Audio);
    const pcmSamples = new Int16Array(
      pcmBytes.buffer,
      pcmBytes.byteOffset,
      Math.floor(pcmBytes.byteLength / 2),
    );
    const audioBuffer = context.createBuffer(1, pcmSamples.length, sampleRate);
    const channel = audioBuffer.getChannelData(0);

    for (let index = 0; index < pcmSamples.length; index += 1) {
      channel[index] = pcmSamples[index] / 0x8000;
    }

    this.playbackPromise = this.playbackPromise
      .catch(() => undefined)
      .then(
        () =>
          new Promise<void>((resolve) => {
            const source = context.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(context.destination);
            this.activeSources.add(source);
            source.onended = () => {
              this.activeSources.delete(source);
              resolve();
            };
            source.start();
          }),
      );

    await this.playbackPromise;
  }

  private stopPlayback(): void {
    for (const source of this.activeSources) {
      source.stop();
    }

    this.activeSources.clear();
    this.playbackPromise = Promise.resolve();
  }

  private async cleanup(resetStatus: boolean): Promise<void> {
    this.stopPlayback();
    this.stopVideoFrames();
    this.stopCamera();

    this.microphoneStream?.getTracks().forEach((track) => track.stop());
    this.microphoneStream = null;
    this.microphoneSourceNode?.disconnect();
    this.microphoneSourceNode = null;
    this.scriptProcessorNode?.disconnect();
    this.scriptProcessorNode = null;

    if (this.inputAudioContext) {
      await this.inputAudioContext.close().catch(() => undefined);
      this.inputAudioContext = null;
    }

    if (this.outputAudioContext) {
      await this.outputAudioContext.close().catch(() => undefined);
      this.outputAudioContext = null;
    }

    this.session = null;
    this.disconnecting = false;

    this.handlers.onPermissionsChange({
      microphone: "unknown",
      camera: "unknown",
    });

    if (resetStatus) {
      this.handlers.onStatusChange("disconnected");
    }
  }
}
