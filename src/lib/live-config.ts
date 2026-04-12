import "server-only";

import {
  Modality,
  type FunctionDeclaration,
  type LiveConnectConfig,
} from "@google/genai";

import type { LiveClientConfig } from "@/lib/live-types";

export const DEFAULT_LIVE_MODEL =
  process.env.GEMINI_LIVE_MODEL ?? "gemini-live-2.5-flash-preview";

export const GET_TIME_TOOL: FunctionDeclaration = {
  name: "get_time",
  description: "Get the current server time in a requested IANA timezone.",
  parametersJsonSchema: {
    type: "object",
    properties: {
      timeZone: {
        type: "string",
        description: "An IANA time zone like America/Los_Angeles.",
      },
    },
    additionalProperties: false,
  },
};

export const LIVE_SYSTEM_INSTRUCTION = {
  role: "system",
  parts: [
    {
      text:
        "You are a concise multimodal assistant in a live voice and video chat. " +
        "Keep spoken responses brief, ask clarifying questions when needed, and " +
        "use the get_time tool when the user asks for the current time.",
    },
  ],
};

export const LIVE_CONNECT_CONFIG: LiveConnectConfig = {
  responseModalities: [Modality.AUDIO],
  temperature: 0.7,
  systemInstruction: LIVE_SYSTEM_INSTRUCTION,
  tools: [{ functionDeclarations: [GET_TIME_TOOL] }],
  inputAudioTranscription: {},
  outputAudioTranscription: {},
};

export const CLIENT_LIVE_CONFIG: LiveClientConfig = {
  model: DEFAULT_LIVE_MODEL,
  responseModalities: ["AUDIO"],
  supportsVideo: true,
  defaultMode: "continuous",
};
