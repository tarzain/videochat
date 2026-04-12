import "server-only";

import { fal } from "@fal-ai/client";

import type {
  CameraSnapshotPayload,
  GenerateImageResult,
} from "@/lib/live-types";

const FLUX_TEXT_ENDPOINT = "fal-ai/flux-2";
const FLUX_EDIT_ENDPOINT = "fal-ai/flux-2/edit";
const FLUX_IMAGE_SIZE = 1024;
const FLUX_STYLE_PREFIX =
  "Beautiful illustrated poster with clean ink linework, soft diffuse lighting, " +
  "and a restrained palette of grays, muted greens, and warm accents; elegant " +
  "simplified composition, minimal texture, clear hierarchy, not cartoonish and not photorealistic. " +
  "Content: ";

export type FluxStreamEvent =
  | {
      type: "started";
      message: string;
    }
  | {
      type: "preview";
      imageUrl: string;
    }
  | {
      type: "progress";
      message: string;
    }
  | {
      type: "completed";
      result: GenerateImageResult;
    };

interface FluxOutputData {
  images?: Array<{ url?: string }>;
  prompt?: string;
  seed?: number;
}

interface FluxImageLike {
  url?: unknown;
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

function createFluxInput(params: {
  contents: string;
  cameraSnapshot?: CameraSnapshotPayload;
  useCurrentCameraImage?: boolean;
  applyStylePrefix?: boolean;
}) {
  return async () => {
    const applyStylePrefix = params.applyStylePrefix !== false;
    const prompt = applyStylePrefix
      ? `${FLUX_STYLE_PREFIX}${params.contents.trim()}`
      : params.contents.trim();
    const referenceImageUrl =
      params.useCurrentCameraImage && params.cameraSnapshot
        ? await uploadCameraSnapshot(params.cameraSnapshot)
        : undefined;
    const endpoint = referenceImageUrl ? FLUX_EDIT_ENDPOINT : FLUX_TEXT_ENDPOINT;

    return {
      endpoint,
      prompt,
      input: {
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
        ...(referenceImageUrl ? { image_urls: [referenceImageUrl] } : {}),
      },
      usedCameraImage: Boolean(referenceImageUrl),
      usedStylePrefix: applyStylePrefix,
    };
  };
}

function getProgressMessages(update: unknown): string[] {
  if (!update || typeof update !== "object") {
    return ["Image generation in progress."];
  }

  const candidate = update as {
    status?: unknown;
    logs?: Array<{ message?: unknown }> | unknown;
    message?: unknown;
  };

  if (Array.isArray(candidate.logs)) {
    const messages = candidate.logs
      .map((log) => (typeof log?.message === "string" ? log.message : null))
      .filter((message): message is string => Boolean(message?.trim()));

    if (messages.length > 0) {
      return messages;
    }
  }

  if (typeof candidate.message === "string" && candidate.message.trim()) {
    return [candidate.message.trim()];
  }

  if (typeof candidate.status === "string" && candidate.status.trim()) {
    return [`Flux status: ${candidate.status.trim()}`];
  }

  return ["Image generation in progress."];
}

function getImageUrlsFromUpdate(update: unknown): string[] {
  if (!update || typeof update !== "object") {
    return [];
  }

  const candidate = update as {
    images?: Array<FluxImageLike> | unknown;
    data?: {
      images?: Array<FluxImageLike> | unknown;
    };
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

export async function streamFluxImage(
  params: {
    contents: string;
    cameraSnapshot?: CameraSnapshotPayload;
    useCurrentCameraImage?: boolean;
    applyStylePrefix?: boolean;
  },
  onEvent: (event: FluxStreamEvent) => Promise<void> | void,
): Promise<GenerateImageResult> {
  ensureFalConfigured();

  const resolveInput = createFluxInput(params);
  const { endpoint, input, prompt, usedCameraImage, usedStylePrefix } =
    await resolveInput();

  await onEvent({
    type: "started",
    message: usedCameraImage
      ? "Starting Flux image generation with the current camera reference."
      : usedStylePrefix
        ? "Starting stylized Flux image generation."
        : "Starting faithful Flux image generation.",
  });

  const stream = await fal.stream(endpoint, { input });
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

    const messages = getProgressMessages(update);

    for (const message of messages) {
      await onEvent({
        type: "progress",
        message,
      });
    }
  }

  const result = await stream.done();
  const output = getFluxOutputData(result);
  const imageUrl = output.images?.[0]?.url;

  if (!imageUrl) {
    throw new Error("Flux did not return an image URL.");
  }

  const finalResult = {
    imageUrl,
    prompt: output.prompt || prompt,
    seed: output.seed,
    usedCameraImage,
    usedStylePrefix,
  };

  await onEvent({
    type: "completed",
    result: finalResult,
  });

  return finalResult;
}

export async function generateFluxImage(params: {
  contents: string;
  cameraSnapshot?: CameraSnapshotPayload;
  useCurrentCameraImage?: boolean;
  applyStylePrefix?: boolean;
}): Promise<GenerateImageResult> {
  let finalResult: GenerateImageResult | null = null;

  await streamFluxImage(params, async (event) => {
    if (event.type === "completed") {
      finalResult = event.result;
    }
  });

  if (!finalResult) {
    throw new Error("Flux generation completed without a final result.");
  }

  return finalResult;
}
