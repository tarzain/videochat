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

export const GENERATE_IMAGE_TOOL: FunctionDeclaration = {
  name: "generate_image",
  description:
    "Generate an image from a content description, optionally using the current camera frame as reference and optionally disabling the default illustration style for faithful edits.",
  parametersJsonSchema: {
    type: "object",
    properties: {
      contents: {
        type: "string",
        description:
          "The content-specific subject or composition to render.",
      },
      useCurrentCameraImage: {
        type: "boolean",
        description:
          "If true, use the user's current camera image as an additional reference.",
      },
      applyStylePrefix: {
        type: "boolean",
        description:
          "If true or omitted, apply the default illustrated poster style. Set false for faithful image edits or when the result should stay close to the source photo.",
      },
    },
    additionalProperties: false,
    required: ["contents"],
  },
};

export const LIVE_SYSTEM_INSTRUCTION = {
  role: "system",
  parts: [
    {
      text:
        "You are a concise multimodal assistant in a live voice and video chat. " +
        "Keep spoken responses brief, ask clarifying questions when needed, and " +
        "use the get_time tool when the user asks for the current time. " +
        "Use the generate_image tool when the user asks for an illustration or generated image. " +
        "Leave applyStylePrefix enabled for stylized artwork, and set it to false when the user wants a faithful edit or a result that should stay close to their photo.",
    },
  ],
};

export const LIVE_CONNECT_CONFIG: LiveConnectConfig = {
  responseModalities: [Modality.AUDIO],
  temperature: 0.7,
  systemInstruction: LIVE_SYSTEM_INSTRUCTION,
  tools: [{ functionDeclarations: [GET_TIME_TOOL, GENERATE_IMAGE_TOOL] }],
  inputAudioTranscription: {},
  outputAudioTranscription: {},
};

export const CLIENT_LIVE_CONFIG: LiveClientConfig = {
  model: DEFAULT_LIVE_MODEL,
  responseModalities: ["AUDIO"],
  supportsVideo: true,
  defaultMode: "continuous",
};
