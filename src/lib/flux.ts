import "server-only";

import { fal } from "@fal-ai/client";

import type {
  CameraSnapshotPayload,
  GenerateImageResult,
} from "@/lib/live-types";

const FLUX_ENDPOINT = "fal-ai/flux-2";
const FLUX_STYLE_PREFIX =
  "Beautiful illustrated poster with clean ink linework, soft diffuse lighting, " +
  "and a restrained palette of grays, muted greens, and warm accents; elegant " +
  "simplified composition, minimal texture, clear hierarchy, not cartoonish and not photorealistic. " +
  "Content: ";

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

export async function generateFluxImage(params: {
  contents: string;
  cameraSnapshot?: CameraSnapshotPayload;
  useCurrentCameraImage?: boolean;
}): Promise<GenerateImageResult> {
  ensureFalConfigured();

  const prompt = `${FLUX_STYLE_PREFIX}${params.contents.trim()}`;
  const referenceImageUrl =
    params.useCurrentCameraImage && params.cameraSnapshot
      ? await uploadCameraSnapshot(params.cameraSnapshot)
      : undefined;

  const result = await fal.subscribe(FLUX_ENDPOINT, {
    input: {
      prompt,
      guidance_scale: 2.5,
      num_inference_steps: 28,
      image_size: {
        width: 1536,
        height: 1536,
      },
      num_images: 1,
      acceleration: "regular",
      enable_safety_checker: true,
      output_format: "png",
      sync_mode: true,
      ...(referenceImageUrl ? { image_urls: [referenceImageUrl] } : {}),
    },
  });

  const imageUrl = result.data.images?.[0]?.url;

  if (!imageUrl) {
    throw new Error("Flux did not return an image URL.");
  }

  return {
    imageUrl,
    prompt: result.data.prompt || prompt,
    seed: result.data.seed,
    usedCameraImage: Boolean(referenceImageUrl),
  };
}
