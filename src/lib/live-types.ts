export type LiveSessionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "disconnecting"
  | "error";

export type TranscriptRole = "user" | "model" | "tool" | "system";

export type TranscriptEntryKind =
  | "text"
  | "tool-call"
  | "tool-result"
  | "status"
  | "error";

export type TranscriptToolState =
  | "input-available"
  | "output-available"
  | "output-error";

export interface CameraSnapshotPayload {
  data: string;
  mimeType: string;
}

export interface GenerateImageResult {
  imageUrl: string;
  prompt: string;
  seed?: number;
  usedCameraImage: boolean;
  usedGeneratedImage: boolean;
  usedStylePrefix: boolean;
  imageModel?: string;
  imageModelPreset?: ImageModelPreset;
}

export type ImageModelPreset = "flux" | "nano-banana";

export interface TranscriptToolData {
  name: string;
  state: TranscriptToolState;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  imageUrl?: string;
}

export interface TranscriptEntry {
  id: string;
  role: TranscriptRole;
  kind: TranscriptEntryKind;
  text: string;
  timestamp: string;
  tool?: TranscriptToolData;
}

export interface ToolCallRequest {
  name: string;
  args: unknown;
  callId: string;
  cameraSnapshot?: CameraSnapshotPayload;
  referenceImageUrls?: string[];
  imageModelPreset?: ImageModelPreset;
}

export interface ToolCallResponse {
  name: string;
  callId: string;
  result: unknown;
  error?: string;
}

export interface LiveClientConfig {
  model: string;
  responseModalities: string[];
  supportsVideo: boolean;
  defaultMode: "continuous" | "push-to-talk";
}

export interface TokenRouteResponse {
  token: string;
  clientConfig: LiveClientConfig;
}

export interface LivePermissionsState {
  microphone: "unknown" | "granted" | "denied";
  camera: "unknown" | "granted" | "denied";
}

export type StreamStatus =
  | "disconnected"
  | "connecting"
  | "waiting_for_first_chunk"
  | "playing"
  | "degraded_to_image";

export type StreamMediaSurfaceMode = "image" | "stream";

export interface StreamTarget {
  key: string;
  imageDataUrl: string;
  prompt: string;
  width: number;
  height: number;
  frameRate: number;
  numFrames: number;
  maxSegments: number;
  loopyStrategy: string;
  position?: number;
}

export interface StreamSessionState {
  status: StreamStatus;
  error: string;
  hasPlayableVideo: boolean;
  mediaSurfaceMode: StreamMediaSurfaceMode;
}
