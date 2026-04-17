import "server-only";

import { fal } from "@fal-ai/client";

import type {
  CameraSnapshotPayload,
  GenerateImageResult,
  ImageModelPreset,
} from "@/lib/live-types";

const DEFAULT_IMAGE_MODEL_PRESET = "flux";
const DEFAULT_FAL_MODEL_ID = "fal-ai/nano-banana-2/edit";
const DEFAULT_FAL_TEXT_MODEL_ID = "fal-ai/nano-banana-2";
const DEFAULT_FAL_TURBO_MODEL_ID = "fal-ai/flux-2";
const SQUARE_ASPECT_RATIO = "1:1";
const FLUX_IMAGE_SIZE = 1024;

const FLUX_FAST_STYLE_PROMPT =
  "Beatiful llustrated poster with clean ink linework, soft diffuse lighting, and a restrained palette (grays, muted greens, warm accents); elegant simplified architecture, minimal texture, clear hierarchy, not cartoonish or photorealistic. " +
  "Content: ";

const NANO_BANANA_FIXED_STYLE_PROMPT =
  "You can generate a new visual article expanding on the topic the user has chosen. If there is an existing reference image, you should use it as helpful context for the user's query, but the new image should be an entirely new composition, does not have to use the same layout as the original. The new image should be a highly detailed isometric illustration of the following scene.\n" +
  "Refined, restrained color palette with clear colors, soft grays, natural greens, and subtle warm accents.\n" +
  "Precise, clean linework with fine ink outlines and minimal, controlled texture shading.\n" +
  "Calm, contemplative atmosphere with a subtle editorial / architectural diagram quality.\n" +
  "Environment-rich composition with intentional spacing, reduced clutter, and clear visual hierarchy.\n" +
  "Architecture is elegant and slightly stylized, with simplified forms and material clarity (wood, canvas, natural materials).\n" +
  "Top-down/isometric perspective, soft diffuse lighting, no harsh shadows.\n" +
  "Highly intricate yet composed and legible, like a museum illustration or architectural plate.\n" +
  "Illustration style similar to refined editorial illustration or architectural diagrams, not whimsical or cartoonish, not photorealistic. Make form elements look beautiful, well-organized, and native to the image / medium. Make sure they feel integrated into the picture. Content: ";

export type ImageGenerationStreamEvent =
  | { type: "started"; message: string }
  | { type: "preview"; imageUrl: string }
  | { type: "progress"; message: string }
  | { type: "completed"; result: GenerateImageResult };

interface FluxImageLike {
  url?: unknown;
}

interface FluxOutputData {
  images?: Array<{ url?: string }>;
  prompt?: string;
  seed?: number;
}

function ensureFalConfigured() {
  const falKey = process.env.FAL_KEY;

  if (!falKey) {
    throw new Error("Missing FAL_KEY on the server.");
  }

  fal.config({
    credentials: falKey,
  });
}

function normalizeImageModelPreset(value: string | undefined): ImageModelPreset {
  return value === "nano-banana" ? "nano-banana" : DEFAULT_IMAGE_MODEL_PRESET;
}

function getImageGenerationSettings(presetOverride?: ImageModelPreset) {
  const preset =
    presetOverride ?? normalizeImageModelPreset(process.env.LIVE_IMAGE_MODEL_PRESET);

  return {
    preset,
    nanoBananaEditModelId:
      process.env.FAL_MODEL_ID ||
      process.env.NANO_BANANA_EDIT_MODEL_ID ||
      DEFAULT_FAL_MODEL_ID,
    nanoBananaTextModelId:
      process.env.FAL_TEXT_MODEL_ID ||
      process.env.NANO_BANANA_TEXT_MODEL_ID ||
      DEFAULT_FAL_TEXT_MODEL_ID,
    fluxModelId:
      process.env.FAL_TURBO_MODEL_ID ||
      process.env.FLUX_TEXT_MODEL_ID ||
      process.env.FLUX_EDIT_MODEL_ID ||
      DEFAULT_FAL_TURBO_MODEL_ID,
  };
}

function composeFinalPrompt(
  contents: string,
  preset: ImageModelPreset,
  applyStylePrefix: boolean,
) {
  const trimmed = contents.trim();

  if (!applyStylePrefix) {
    return trimmed;
  }

  return preset === "flux"
    ? `${FLUX_FAST_STYLE_PROMPT}${trimmed}`.trim()
    : `${NANO_BANANA_FIXED_STYLE_PROMPT}${trimmed}`.trim();
}

async function uploadCameraSnapshot(
  snapshot: CameraSnapshotPayload | undefined,
): Promise<string | undefined> {
  if (!snapshot) {
    return undefined;
  }

  const bytes = Buffer.from(snapshot.data, "base64");
  const extension = snapshot.mimeType.includes("png") ? "png" : "jpg";
  const file = new File([bytes], `camera-snapshot.${extension}`, {
    type: snapshot.mimeType,
  });

  return fal.storage.upload(file);
}

function extractFalImageUrl(payload: unknown): string | null {
  const candidate = payload as {
    data?: { images?: Array<{ url?: string }> };
    images?: Array<{ url?: string }>;
    output?: { images?: Array<{ url?: string }> };
    result?: { images?: Array<{ url?: string }> };
    image?: { url?: string };
    image_url?: string;
    url?: string;
  };

  return (
    candidate?.data?.images?.[0]?.url ||
    candidate?.images?.[0]?.url ||
    candidate?.output?.images?.[0]?.url ||
    candidate?.result?.images?.[0]?.url ||
    candidate?.image?.url ||
    candidate?.image_url ||
    candidate?.url ||
    null
  );
}

function getImageUrlsFromUpdate(update: unknown): string[] {
  if (!update || typeof update !== "object") {
    return [];
  }

  const candidate = update as {
    images?: Array<FluxImageLike> | unknown;
    data?: { images?: Array<FluxImageLike> | unknown };
  };

  const images = Array.isArray(candidate.images)
    ? candidate.images
    : Array.isArray(candidate.data?.images)
      ? candidate.data.images
      : [];

  return images
    .map((image) => (typeof image?.url === "string" ? image.url : null))
    .filter((url): url is string => Boolean(url));
}

function getFluxOutputData(result: unknown): FluxOutputData {
  if (!result || typeof result !== "object") {
    return {};
  }

  const candidate = result as {
    data?: FluxOutputData;
    images?: Array<{ url?: string }>;
    prompt?: string;
    seed?: number;
  };

  return candidate.data ?? candidate;
}

async function responseImageUrlToDataUrl(imageUrl: string, defaultMimeType: string) {
  const response = await fetch(imageUrl);

  if (!response.ok) {
    throw new Error("Image provider returned an image URL, but the generated image could not be downloaded.");
  }

  const arrayBuffer = await response.arrayBuffer();
  const mimeType = (response.headers.get("content-type") || defaultMimeType).split(";")[0];

  return {
    imageUrl: `data:${mimeType};base64,${Buffer.from(arrayBuffer).toString("base64")}`,
    sourceImageUrl: imageUrl,
  };
}

function buildStartedMessage(params: {
  preset: ImageModelPreset;
  usedCameraImage: boolean;
  usedGeneratedImage: boolean;
  usedStylePrefix: boolean;
}) {
  const modelLabel = params.preset === "flux" ? "Flux" : "Nano Banana";

  if (params.usedCameraImage && params.usedGeneratedImage) {
    return `Starting ${modelLabel} image generation with both the current camera and latest generated image as references.`;
  }

  if (params.usedCameraImage) {
    return `Starting ${modelLabel} image generation with the current camera reference.`;
  }

  if (params.usedGeneratedImage) {
    return `Starting ${modelLabel} image generation with the latest generated image as reference.`;
  }

  return params.usedStylePrefix
    ? `Starting stylized ${modelLabel} image generation.`
    : `Starting faithful ${modelLabel} image generation.`;
}

async function resolveGenerationInput(params: {
  contents: string;
  cameraSnapshot?: CameraSnapshotPayload;
  useCurrentCameraImage?: boolean;
  referenceImageUrls?: string[];
  applyStylePrefix?: boolean;
  imageModelPreset?: ImageModelPreset;
}) {
  const settings = getImageGenerationSettings(params.imageModelPreset);
  const usedStylePrefix = params.applyStylePrefix !== false;
  const prompt = composeFinalPrompt(params.contents, settings.preset, usedStylePrefix);
  const uploadedCameraReferenceImageUrl =
    params.useCurrentCameraImage && params.cameraSnapshot
      ? await uploadCameraSnapshot(params.cameraSnapshot)
      : undefined;
  const referenceImageUrls = [
    ...(uploadedCameraReferenceImageUrl ? [uploadedCameraReferenceImageUrl] : []),
    ...(params.referenceImageUrls ?? []),
  ];
  const usedCameraImage = Boolean(uploadedCameraReferenceImageUrl);
  const usedGeneratedImage = Boolean((params.referenceImageUrls?.length ?? 0) > 0);

  return {
    settings,
    prompt,
    referenceImageUrls,
    usedCameraImage,
    usedGeneratedImage,
    usedStylePrefix,
  };
}

export async function streamGeneratedImage(
  params: {
    contents: string;
    cameraSnapshot?: CameraSnapshotPayload;
    useCurrentCameraImage?: boolean;
    referenceImageUrls?: string[];
    applyStylePrefix?: boolean;
    imageModelPreset?: ImageModelPreset;
  },
  onEvent: (event: ImageGenerationStreamEvent) => Promise<void> | void,
): Promise<GenerateImageResult> {
  ensureFalConfigured();

  const {
    settings,
    prompt,
    referenceImageUrls,
    usedCameraImage,
    usedGeneratedImage,
    usedStylePrefix,
  } = await resolveGenerationInput(params);

  await onEvent({
    type: "started",
    message: buildStartedMessage({
      preset: settings.preset,
      usedCameraImage,
      usedGeneratedImage,
      usedStylePrefix,
    }),
  });

  if (settings.preset === "flux") {
    const modelId = settings.fluxModelId;
    const input = {
      prompt,
      guidance_scale: 2.5,
      num_inference_steps: 28,
      image_size: {
        width: FLUX_IMAGE_SIZE,
        height: FLUX_IMAGE_SIZE,
      },
      num_images: 1,
      acceleration: "regular" as const,
      sync_mode: true,
      enable_safety_checker: true,
      output_format: "jpeg" as const,
      ...(referenceImageUrls.length > 0 ? { image_urls: referenceImageUrls } : {}),
    };

    const stream = await fal.stream(modelId, { input });
    const emittedPreviewUrls = new Set<string>();

    for await (const update of stream) {
      const imageUrls = getImageUrlsFromUpdate(update);

      for (const imageUrl of imageUrls) {
        if (emittedPreviewUrls.has(imageUrl)) {
          continue;
        }

        emittedPreviewUrls.add(imageUrl);
        await onEvent({
          type: "preview",
          imageUrl,
        });
      }
    }

    const result = await stream.done();
    const output = getFluxOutputData(result);
    const sourceImageUrl = output.images?.[0]?.url ?? extractFalImageUrl(result);

    if (!sourceImageUrl) {
      throw new Error("Flux did not return an image URL.");
    }

    const finalImage = await responseImageUrlToDataUrl(sourceImageUrl, "image/jpeg");
    const finalResult: GenerateImageResult = {
      imageUrl: finalImage.imageUrl,
      prompt: output.prompt || prompt,
      seed: output.seed,
      usedCameraImage,
      usedGeneratedImage,
      usedStylePrefix,
      imageModel: modelId,
      imageModelPreset: settings.preset,
    };

    await onEvent({
      type: "completed",
      result: finalResult,
    });

    return finalResult;
  }

  const modelId =
    referenceImageUrls.length > 0
      ? settings.nanoBananaEditModelId
      : settings.nanoBananaTextModelId;
  const input = {
    prompt,
    num_images: 1,
    output_format: "jpeg" as const,
    aspect_ratio: SQUARE_ASPECT_RATIO,
    resolution: "1K" as const,
    thinking_level: "minimal" as const,
    ...(referenceImageUrls.length > 0 ? { image_urls: referenceImageUrls } : {}),
  };
  const result = await fal.subscribe(modelId, { input });
  const sourceImageUrl = extractFalImageUrl(result);

  if (!sourceImageUrl) {
    throw new Error("Nano Banana did not return an image URL.");
  }

  const finalImage = await responseImageUrlToDataUrl(sourceImageUrl, "image/jpeg");
  const finalResult: GenerateImageResult = {
    imageUrl: finalImage.imageUrl,
    prompt,
    usedCameraImage,
    usedGeneratedImage,
    usedStylePrefix,
    imageModel: modelId,
    imageModelPreset: settings.preset,
  };

  await onEvent({
    type: "completed",
    result: finalResult,
  });

  return finalResult;
}

export async function generateImage(params: {
  contents: string;
  cameraSnapshot?: CameraSnapshotPayload;
  useCurrentCameraImage?: boolean;
  referenceImageUrls?: string[];
  applyStylePrefix?: boolean;
  imageModelPreset?: ImageModelPreset;
}): Promise<GenerateImageResult> {
  let finalResult: GenerateImageResult | null = null;

  await streamGeneratedImage(params, async (event) => {
    if (event.type === "completed") {
      finalResult = event.result;
    }
  });

  if (!finalResult) {
    throw new Error("Image generation completed without a final result.");
  }

  return finalResult;
}
