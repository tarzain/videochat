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
}

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
