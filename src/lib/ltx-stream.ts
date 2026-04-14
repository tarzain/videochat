"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

import type {
  StreamMediaSurfaceMode,
  StreamSessionState,
  StreamStatus,
  StreamTarget,
} from "@/lib/live-types";

const DEFAULT_LTX_STREAM_URL =
  "wss://tmalive--ltx-stream-diffusersltx2streamingengine-streaming-app.modal.run/ws/stream";
const DEFAULT_TARGET_POSITION = 1.0;
const DEFAULT_STREAM_PROMPT =
  "Create a faithful looping motion pass for this single still image. Preserve composition, subject, and framing. Add subtle cinematic movement only.";

function parseIntegerValue(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBooleanValue(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return fallback;
}

export const LTX_STREAM_SETTINGS = {
  enabled: parseBooleanValue(process.env.NEXT_PUBLIC_LTX_STREAM_ENABLED, true),
  url: process.env.NEXT_PUBLIC_LTX_STREAM_URL || DEFAULT_LTX_STREAM_URL,
  width: parseIntegerValue(process.env.NEXT_PUBLIC_LTX_STREAM_WIDTH, 768),
  height: parseIntegerValue(process.env.NEXT_PUBLIC_LTX_STREAM_HEIGHT, 768),
  frameRate: parseIntegerValue(process.env.NEXT_PUBLIC_LTX_STREAM_FRAME_RATE, 24),
  numFrames: parseIntegerValue(process.env.NEXT_PUBLIC_LTX_STREAM_NUM_FRAMES, 49),
  maxSegments: parseIntegerValue(process.env.NEXT_PUBLIC_LTX_STREAM_MAX_SEGMENTS, 9999),
  loopyStrategy:
    process.env.NEXT_PUBLIC_LTX_STREAM_LOOPY_STRATEGY || "anchor_loop",
  position: DEFAULT_TARGET_POSITION,
  prompt: process.env.NEXT_PUBLIC_LTX_STREAM_PROMPT || DEFAULT_STREAM_PROMPT,
} as const;

function createStreamSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `ltx_stream_${crypto.randomUUID()}`;
  }

  return `ltx_stream_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function readUint32(buffer: Uint8Array, offset: number): number {
  return (
    (buffer[offset] << 24) |
    (buffer[offset + 1] << 16) |
    (buffer[offset + 2] << 8) |
    buffer[offset + 3]
  ) >>> 0;
}

function readUint64(buffer: Uint8Array, offset: number): number {
  const high = BigInt(readUint32(buffer, offset));
  const low = BigInt(readUint32(buffer, offset + 4));
  return Number((high << BigInt(32)) | low);
}

function readAscii(buffer: Uint8Array, offset: number, length: number): string {
  let value = "";

  for (let index = 0; index < length; index += 1) {
    value += String.fromCharCode(buffer[offset + index] ?? 0);
  }

  return value;
}

interface Mp4Box {
  type: string;
  start: number;
  size: number;
  headerSize: number;
  dataStart: number;
  end: number;
}

function parseBoxes(buffer: Uint8Array, start: number, end: number): Mp4Box[] {
  const boxes: Mp4Box[] = [];
  let offset = start;

  while (offset + 8 <= end) {
    let size = readUint32(buffer, offset);
    const type = readAscii(buffer, offset + 4, 4);
    let headerSize = 8;

    if (size === 1) {
      if (offset + 16 > end) {
        break;
      }

      size = readUint64(buffer, offset + 8);
      headerSize = 16;
    } else if (size === 0) {
      size = end - offset;
    }

    if (size < headerSize || offset + size > end) {
      break;
    }

    boxes.push({
      type,
      start: offset,
      size,
      headerSize,
      dataStart: offset + headerSize,
      end: offset + size,
    });

    offset += size;
  }

  return boxes;
}

function findFirstBox(
  buffer: Uint8Array,
  start: number,
  end: number,
  type: string,
): Mp4Box | null {
  return parseBoxes(buffer, start, end).find((box) => box.type === type) ?? null;
}

function findStsdBox(buffer: Uint8Array): Mp4Box | null {
  const moov = findFirstBox(buffer, 0, buffer.length, "moov");
  if (!moov) {
    return null;
  }

  const moovChildren = parseBoxes(buffer, moov.dataStart, moov.end);

  for (const trak of moovChildren.filter((box) => box.type === "trak")) {
    const mdia = findFirstBox(buffer, trak.dataStart, trak.end, "mdia");
    const minf = mdia
      ? findFirstBox(buffer, mdia.dataStart, mdia.end, "minf")
      : null;
    const stbl = minf
      ? findFirstBox(buffer, minf.dataStart, minf.end, "stbl")
      : null;
    const stsd = stbl
      ? findFirstBox(buffer, stbl.dataStart, stbl.end, "stsd")
      : null;

    if (stsd) {
      return stsd;
    }
  }

  return null;
}

function toHexByte(value: number): string {
  return value.toString(16).padStart(2, "0").toUpperCase();
}

function parseAvcCodecString(buffer: Uint8Array, sampleEntry: Mp4Box): string | null {
  const avcC = findFirstBox(buffer, sampleEntry.dataStart + 78, sampleEntry.end, "avcC");

  if (!avcC || avcC.dataStart + 4 > avcC.end) {
    return null;
  }

  const profile = buffer[avcC.dataStart + 1];
  const compatibility = buffer[avcC.dataStart + 2];
  const level = buffer[avcC.dataStart + 3];

  if (profile === undefined || compatibility === undefined || level === undefined) {
    return null;
  }

  return `${sampleEntry.type}.${toHexByte(profile)}${toHexByte(compatibility)}${toHexByte(level)}`;
}

function parseHevcCodecString(buffer: Uint8Array, sampleEntry: Mp4Box): string | null {
  const hvcC = findFirstBox(buffer, sampleEntry.dataStart + 78, sampleEntry.end, "hvcC");

  if (!hvcC || hvcC.dataStart + 13 > hvcC.end) {
    return null;
  }

  const profileByte = buffer[hvcC.dataStart + 1];
  if (profileByte === undefined) {
    return null;
  }

  const profileSpace = ["", "A", "B", "C"][(profileByte >> 6) & 0x03] ?? "";
  const tierFlag = ((profileByte >> 5) & 0x01) === 1 ? "H" : "L";
  const profileIdc = profileByte & 0x1f;
  const compatibility = readUint32(buffer, hvcC.dataStart + 2)
    .toString(16)
    .toUpperCase();
  const levelIdc = buffer[hvcC.dataStart + 12];

  if (levelIdc === undefined) {
    return null;
  }

  const constraintBytes: number[] = [];

  for (let index = 0; index < 6; index += 1) {
    const byte = buffer[hvcC.dataStart + 6 + index];
    if (byte === undefined) {
      return null;
    }

    constraintBytes.push(byte);
  }

  while (constraintBytes.length > 0 && constraintBytes.at(-1) === 0) {
    constraintBytes.pop();
  }

  const constraints = constraintBytes.map((byte) => toHexByte(byte)).join(".");

  return `${sampleEntry.type}.${profileSpace}${profileIdc}.${compatibility}.${tierFlag}${levelIdc}${
    constraints ? `.${constraints}` : ""
  }`;
}

function resolveMp4MimeType(
  payload: ArrayBuffer | Uint8Array,
  fallbackMediaType: string,
): string | null {
  const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
  const stsd = findStsdBox(bytes);

  if (!stsd || stsd.dataStart + 8 > stsd.end) {
    return null;
  }

  const entryCount = readUint32(bytes, stsd.dataStart + 4);

  if (entryCount < 1) {
    return null;
  }

  const sampleEntryStart = stsd.dataStart + 8;
  const sampleEntries = parseBoxes(bytes, sampleEntryStart, stsd.end);
  const sampleEntry = sampleEntries[0];

  if (!sampleEntry) {
    return null;
  }

  let codec: string | null = null;

  if (sampleEntry.type === "avc1" || sampleEntry.type === "avc3") {
    codec = parseAvcCodecString(bytes, sampleEntry);
  } else if (sampleEntry.type === "hvc1" || sampleEntry.type === "hev1") {
    codec = parseHevcCodecString(bytes, sampleEntry);
  }

  if (!codec) {
    return null;
  }

  return `${fallbackMediaType}; codecs="${codec}"`;
}

interface StreamPacketHeader {
  media_type?: string;
  [key: string]: unknown;
}

function parseStreamPacket(packet: ArrayBuffer | Uint8Array): {
  header: StreamPacketHeader;
  payload: Uint8Array;
} {
  const bytes = packet instanceof Uint8Array ? packet : new Uint8Array(packet);
  const magic = readAscii(bytes, 0, 4);

  if (magic !== "LTXF") {
    throw new Error("Unexpected video packet format.");
  }

  const headerLength = readUint32(bytes, 4);
  const headerBytes = bytes.slice(8, 8 + headerLength);
  const header = JSON.parse(new TextDecoder().decode(headerBytes)) as StreamPacketHeader;
  const payload = bytes.slice(8 + headerLength);

  return { header, payload };
}

function derivePlaybackState(
  status: StreamStatus,
  hasPlayableVideo: boolean,
): StreamMediaSurfaceMode {
  return status === "playing" && hasPlayableVideo ? "stream" : "image";
}

function buildStreamConfigFingerprint(target: StreamTarget | null): string {
  if (!target) {
    return "";
  }

  return JSON.stringify({
    width: target.width,
    height: target.height,
    frameRate: target.frameRate,
    numFrames: target.numFrames,
    maxSegments: target.maxSegments,
    loopyStrategy: target.loopyStrategy,
    position:
      typeof target.position === "number" ? target.position : DEFAULT_TARGET_POSITION,
    prompt: target.prompt,
  });
}

function buildStreamTargetFingerprint(target: StreamTarget | null): string {
  if (!target) {
    return "";
  }

  return JSON.stringify({
    key: target.key,
    imageDataUrl: target.imageDataUrl,
  });
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

interface QueuedSegment {
  payload: ArrayBuffer;
}

interface UseLtxStreamSessionArgs {
  enabled: boolean;
  target: StreamTarget | null;
}

interface UseLtxStreamSessionResult extends StreamSessionState {
  captureFrameDataUrl: () => string;
  disconnect: () => void;
  videoRef: RefObject<HTMLVideoElement | null>;
}

export function useLtxStreamSession({
  enabled,
  target,
}: UseLtxStreamSessionArgs): UseLtxStreamSessionResult {
  const [status, setStatus] = useState<StreamStatus>("disconnected");
  const [error, setError] = useState("");
  const [hasPlayableVideo, setHasPlayableVideo] = useState(false);
  const [streamMimeType, setStreamMimeType] = useState("");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const websocketRef = useRef<WebSocket | null>(null);
  const mediaSourceRef = useRef<MediaSource | null>(null);
  const sourceBufferRef = useRef<SourceBuffer | null>(null);
  const objectUrlRef = useRef("");
  const sessionIdRef = useRef(createStreamSessionId());
  const sourceOpenRef = useRef(false);
  const segmentQueueRef = useRef<QueuedSegment[]>([]);
  const targetRef = useRef<StreamTarget | null>(target);
  const startedRef = useRef(false);
  const targetFingerprintRef = useRef("");
  const configFingerprintRef = useRef("");
  const manualCloseRef = useRef(false);
  const enabledRef = useRef(enabled);
  const connectionIdRef = useRef(0);

  targetRef.current = target;

  const disconnect = useRef<() => void>(() => undefined);

  const isActiveConnection = (connectionId: number, websocket: WebSocket | null = null) =>
    connectionId === connectionIdRef.current &&
    (!websocket || websocket === websocketRef.current);

  const cleanupMediaSource = () => {
    sourceBufferRef.current = null;
    sourceOpenRef.current = false;

    if (mediaSourceRef.current) {
      try {
        if (mediaSourceRef.current.readyState === "open") {
          mediaSourceRef.current.endOfStream();
        }
      } catch {
        // Ignore media teardown failures.
      }
    }

    mediaSourceRef.current = null;

    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.removeAttribute("src");
      videoRef.current.load();
    }

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = "";
    }

    setHasPlayableVideo(false);
    setStreamMimeType("");
    segmentQueueRef.current = [];
  };

  const closeWebSocket = (websocket: WebSocket | null = websocketRef.current) => {
    const isCurrentSocket = websocket && websocket === websocketRef.current;

    if (isCurrentSocket) {
      websocketRef.current = null;
      manualCloseRef.current = true;
      connectionIdRef.current += 1;
    }

    if (websocket && websocket.readyState === WebSocket.OPEN) {
      try {
        websocket.send(JSON.stringify({ action: "stop" }));
      } catch {
        // Ignore stop send failures during teardown.
      }
    }

    try {
      websocket?.close();
    } catch {
      // Ignore websocket close failures.
    }

    if (isCurrentSocket) {
      startedRef.current = false;
      targetFingerprintRef.current = "";
      configFingerprintRef.current = "";
    }
  };

  const flushSegmentQueue = (connectionId: number) => {
    if (!isActiveConnection(connectionId)) {
      return;
    }

    const mediaSource = mediaSourceRef.current;
    const sourceBuffer = sourceBufferRef.current;

    if (
      !mediaSource ||
      mediaSource.readyState !== "open" ||
      !sourceBuffer ||
      sourceBuffer.updating ||
      segmentQueueRef.current.length < 1
    ) {
      return;
    }

    const nextSegment = segmentQueueRef.current.shift();

    if (!nextSegment) {
      return;
    }

    try {
      sourceBuffer.appendBuffer(nextSegment.payload);

      if (!hasPlayableVideo) {
        setHasPlayableVideo(true);
        setStatus("playing");
      }
    } catch (appendError) {
      if (!isActiveConnection(connectionId)) {
        return;
      }

      console.error("[videochat] Unable to append stream segment:", appendError);
      setError("Unable to play the live stream.");
      setStatus("degraded_to_image");
      cleanupMediaSource();
      closeWebSocket();
    }
  };

  const ensureMediaSource = (mimeType: string, connectionId: number): boolean => {
    if (!isActiveConnection(connectionId)) {
      return false;
    }

    if (!videoRef.current) {
      return false;
    }

    if (typeof window === "undefined" || !("MediaSource" in window)) {
      setError("Live streaming is not supported in this browser.");
      setStatus("degraded_to_image");
      return false;
    }

    if (!MediaSource.isTypeSupported(mimeType)) {
      setError("This browser cannot play the live stream format.");
      setStatus("degraded_to_image");
      return false;
    }

    if (!mediaSourceRef.current) {
      const mediaSource = new MediaSource();
      mediaSourceRef.current = mediaSource;
      objectUrlRef.current = URL.createObjectURL(mediaSource);
      videoRef.current.src = objectUrlRef.current;
      videoRef.current.load();

      mediaSource.addEventListener("sourceopen", () => {
        if (!isActiveConnection(connectionId)) {
          return;
        }

        sourceOpenRef.current = true;

        if (!sourceBufferRef.current && mimeType) {
          sourceBufferRef.current = mediaSource.addSourceBuffer(mimeType);
          sourceBufferRef.current.mode = "sequence";
          sourceBufferRef.current.addEventListener("updateend", () =>
            flushSegmentQueue(connectionId),
          );
        }

        flushSegmentQueue(connectionId);
      });
    }

    if (sourceOpenRef.current && !sourceBufferRef.current) {
      sourceBufferRef.current = mediaSourceRef.current.addSourceBuffer(mimeType);
      sourceBufferRef.current.mode = "sequence";
      sourceBufferRef.current.addEventListener("updateend", () =>
        flushSegmentQueue(connectionId),
      );
    }

    return true;
  };

  const handleBinaryMessage = (data: ArrayBuffer, connectionId: number) => {
    if (!isActiveConnection(connectionId)) {
      return;
    }

    const { header, payload } = parseStreamPacket(data);
    const fallbackMediaType =
      typeof header.media_type === "string" && header.media_type
        ? header.media_type
        : "video/mp4";
    const mimeType =
      streamMimeType || resolveMp4MimeType(payload, fallbackMediaType);

    if (!mimeType) {
      setError("Unable to determine the live stream video codec.");
      setStatus("degraded_to_image");
      closeWebSocket();
      return;
    }

    if (!streamMimeType) {
      setStreamMimeType(mimeType);
    }

    if (!ensureMediaSource(mimeType, connectionId)) {
      closeWebSocket();
      return;
    }

    segmentQueueRef.current.push({ payload: toArrayBuffer(payload) });
    flushSegmentQueue(connectionId);
  };

  const sendTargetUpdate = (nextTarget: StreamTarget) => {
    const websocket = websocketRef.current;

    if (
      !websocket ||
      websocket.readyState !== WebSocket.OPEN ||
      !startedRef.current ||
      !nextTarget.imageDataUrl
    ) {
      return;
    }

    websocket.send(
      JSON.stringify({
        action: "set_target_image",
        image: nextTarget.imageDataUrl,
        position:
          typeof nextTarget.position === "number"
            ? nextTarget.position
            : DEFAULT_TARGET_POSITION,
      }),
    );
  };

  const connect = () => {
    if (!enabled || !target?.imageDataUrl || websocketRef.current) {
      return;
    }

    setError("");
    setStatus("connecting");
    manualCloseRef.current = false;

    const websocket = new WebSocket(LTX_STREAM_SETTINGS.url);
    const connectionId = connectionIdRef.current + 1;
    connectionIdRef.current = connectionId;
    websocket.binaryType = "arraybuffer";

    websocket.addEventListener("open", () => {
      if (!isActiveConnection(connectionId, websocket)) {
        return;
      }

      const nextTarget = targetRef.current;

      if (!nextTarget?.imageDataUrl) {
        return;
      }

      setStatus("waiting_for_first_chunk");
      websocket.send(
        JSON.stringify({
          action: "start",
          session_id: sessionIdRef.current,
          prompt: nextTarget.prompt,
          width: nextTarget.width,
          height: nextTarget.height,
          num_frames: nextTarget.numFrames,
          frame_rate: nextTarget.frameRate,
          max_segments: nextTarget.maxSegments,
          loopy_mode: true,
          loopy_strategy: nextTarget.loopyStrategy,
          start_image: nextTarget.imageDataUrl,
          target_image: nextTarget.imageDataUrl,
          position:
            typeof nextTarget.position === "number"
              ? nextTarget.position
              : DEFAULT_TARGET_POSITION,
        }),
      );
    });

    websocket.addEventListener("message", (event) => {
      if (!isActiveConnection(connectionId, websocket)) {
        return;
      }

      if (typeof event.data === "string") {
        try {
          const payload = JSON.parse(event.data) as {
            type?: string;
            event?: string;
            message?: string;
          };

          if (payload.type === "session_started" || payload.event === "session_started") {
            startedRef.current = true;
            return;
          }

          if (payload.type === "error" || payload.event === "error") {
            throw new Error(payload.message || "Live stream request failed.");
          }
        } catch (parseError) {
          const message =
            parseError instanceof Error
              ? parseError.message
              : "Live stream request failed.";
          setError(message);
          setStatus("degraded_to_image");
          closeWebSocket();
        }

        return;
      }

      handleBinaryMessage(event.data as ArrayBuffer, connectionId);
    });

    websocket.addEventListener("error", () => {
      if (!isActiveConnection(connectionId, websocket)) {
        return;
      }

      setError("Unable to connect to the live stream.");
      setStatus("degraded_to_image");
    });

    websocket.addEventListener("close", () => {
      if (!isActiveConnection(connectionId, websocket)) {
        return;
      }

      websocketRef.current = null;

      if (manualCloseRef.current) {
        manualCloseRef.current = false;
        return;
      }

      if (enabled && targetRef.current?.imageDataUrl) {
        setStatus((currentStatus) =>
          currentStatus === "playing" ? "degraded_to_image" : currentStatus,
        );
      }
    });

    websocketRef.current = websocket;
  };

  disconnect.current = () => {
    closeWebSocket();
    cleanupMediaSource();
    setStatus("disconnected");
    setError("");
  };

  const restartSession = (
    nextTarget: StreamTarget,
    nextConfigFingerprint: string,
    nextTargetFingerprint: string,
  ) => {
    sessionIdRef.current = createStreamSessionId();
    configFingerprintRef.current = nextConfigFingerprint;
    targetFingerprintRef.current = nextTargetFingerprint;
    disconnect.current();
    targetRef.current = nextTarget;
    connect();
  };

  const captureFrameDataUrl = (): string => {
    const video = videoRef.current;

    if (
      !video ||
      !hasPlayableVideo ||
      video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
    ) {
      return "";
    }

    const width = video.videoWidth || targetRef.current?.width || 0;
    const height = video.videoHeight || targetRef.current?.height || 0;

    if (!width || !height) {
      return "";
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");

    if (!context) {
      return "";
    }

    context.drawImage(video, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", 0.92);
  };

  useEffect(() => {
    if (enabled && !enabledRef.current) {
      sessionIdRef.current = createStreamSessionId();
      targetFingerprintRef.current = "";
      startedRef.current = false;
    }

    enabledRef.current = enabled;
  }, [enabled]);

  /* eslint-disable react-hooks/exhaustive-deps */
  // This effect intentionally keys off the explicit target fields below rather than
  // the recreated helper closures, because session retarget/restart semantics are
  // driven only by those fingerprints.
  useEffect(() => {
    if (!enabled || !target?.imageDataUrl) {
      disconnect.current();
      return;
    }

    const nextConfigFingerprint = buildStreamConfigFingerprint(target);
    const nextTargetFingerprint = buildStreamTargetFingerprint(target);

    if (!websocketRef.current) {
      configFingerprintRef.current = nextConfigFingerprint;
      targetFingerprintRef.current = nextTargetFingerprint;
      connect();
      return;
    }

    if (nextConfigFingerprint !== configFingerprintRef.current) {
      restartSession(target, nextConfigFingerprint, nextTargetFingerprint);
      return;
    }

    if (nextTargetFingerprint !== targetFingerprintRef.current) {
      targetFingerprintRef.current = nextTargetFingerprint;
      sendTargetUpdate(target);
    }
  }, [
    enabled,
    target?.key,
    target?.imageDataUrl,
    target?.width,
    target?.height,
    target?.frameRate,
    target?.numFrames,
    target?.maxSegments,
    target?.loopyStrategy,
    target?.position,
    target?.prompt,
  ]);
  /* eslint-enable react-hooks/exhaustive-deps */

  useEffect(() => {
    if (!hasPlayableVideo) {
      return;
    }

    void videoRef.current?.play().catch(() => undefined);
  }, [hasPlayableVideo]);

  useEffect(
    () => () => {
      disconnect.current();
    },
    [],
  );

  return {
    captureFrameDataUrl,
    disconnect: disconnect.current,
    error,
    hasPlayableVideo,
    mediaSurfaceMode: derivePlaybackState(status, hasPlayableVideo),
    status,
    videoRef,
  };
}
