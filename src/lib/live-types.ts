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

export interface TranscriptEntry {
  id: string;
  role: TranscriptRole;
  kind: TranscriptEntryKind;
  text: string;
  timestamp: string;
}

export interface ToolCallRequest {
  name: string;
  args: unknown;
  callId: string;
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
