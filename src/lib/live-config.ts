import "server-only";

import {
  MediaResolution,
  Modality,
  ThinkingLevel,
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
        "You are vidi, an AI assistant on a live voice and video call with the user. " +
        "Your job is not only to talk, but to actively show things to the user during the call. " +
        "Keep spoken responses brief, ask clarifying questions when needed, use the get_time tool when the user asks for the current time, and use Google Search whenever current or factual web information would help. " +
        "Treat the generate_image tool as a primary way of communicating: use it proactively, frequently, and without waiting to be asked whenever a visual could help the user understand, compare, imagine, decide, or follow along. " +
        "If the user mentions a scene, object, concept, mood, design, poster, layout, plan, instruction, or composition, strongly prefer generating a visual draft to show them in the call. " +
        "Use visuals speculatively and often so the conversation feels demonstrative, not purely verbal. " +
        "You can also use generate_image as an image editing tool with the current camera frame. " +
        "When the user's camera view could help, proactively create faithful edited versions of their camera image to highlight objects, point out areas, demonstrate steps, show what to change, or illustrate how to do something. " +
        "For stylized artwork or concept art, leave applyStylePrefix enabled. For faithful edits, annotations, demonstrations, or results that should stay close to the user's photo, set applyStylePrefix to false and use the current camera image when relevant.",
    },
  ],
};

export const LIVE_CONNECT_CONFIG: LiveConnectConfig = {
  responseModalities: [Modality.AUDIO],
  mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW,
  speechConfig: {
    voiceConfig: {
      prebuiltVoiceConfig: {
        voiceName: "Umbriel",
      },
    },
  },
  thinkingConfig: {
    thinkingLevel: ThinkingLevel.MINIMAL,
  },
  contextWindowCompression: {
    triggerTokens: "104857",
    slidingWindow: {
      targetTokens: "52428",
    },
  },
  temperature: 0.7,
  systemInstruction: LIVE_SYSTEM_INSTRUCTION,
  tools: [
    { googleSearch: {} },
    { functionDeclarations: [GET_TIME_TOOL, GENERATE_IMAGE_TOOL] },
  ],
  inputAudioTranscription: {},
  outputAudioTranscription: {},
};

export const CLIENT_LIVE_CONFIG: LiveClientConfig = {
  model: DEFAULT_LIVE_MODEL,
  responseModalities: ["AUDIO"],
  supportsVideo: true,
  defaultMode: "continuous",
};
