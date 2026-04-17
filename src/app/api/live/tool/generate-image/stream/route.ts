import { streamGeneratedImage } from "@/lib/image-generation";
import type { ImageModelPreset, ToolCallRequest } from "@/lib/live-types";

export const runtime = "nodejs";

function isToolRequest(input: unknown): input is ToolCallRequest {
  if (!input || typeof input !== "object") {
    return false;
  }

  const candidate = input as Partial<ToolCallRequest>;

  return (
    candidate.name === "generate_image" &&
    typeof candidate.callId === "string" &&
    "args" in candidate
  );
}

function parseImageModelPreset(value: unknown): ImageModelPreset | undefined {
  return value === "nano-banana" || value === "flux" ? value : undefined;
}

function parseGenerateImageRequest(request: ToolCallRequest) {
  const parsedArgs =
    request.args && typeof request.args === "object"
      ? (request.args as {
          contents?: unknown;
          useCurrentCameraImage?: unknown;
          useLatestGeneratedImage?: unknown;
          applyStylePrefix?: unknown;
        })
      : {};
  const contents =
    typeof parsedArgs.contents === "string" ? parsedArgs.contents.trim() : "";
  const useCurrentCameraImage = parsedArgs.useCurrentCameraImage === true;
  const useLatestGeneratedImage = parsedArgs.useLatestGeneratedImage === true;
  const applyStylePrefix = parsedArgs.applyStylePrefix !== false;

  if (!contents) {
    throw new Error("generate_image requires a non-empty `contents` string.");
  }

  if (useCurrentCameraImage && !request.cameraSnapshot) {
    throw new Error(
      "generate_image requested the current camera image, but no camera snapshot was available.",
    );
  }

  if (useLatestGeneratedImage && !(request.referenceImageUrls?.length)) {
    throw new Error(
      "generate_image requested the latest generated image, but no prior generated image was available.",
    );
  }

  return {
    contents,
    useCurrentCameraImage,
    referenceImageUrls: useLatestGeneratedImage ? request.referenceImageUrls : undefined,
    applyStylePrefix,
    cameraSnapshot: request.cameraSnapshot,
    imageModelPreset: parseImageModelPreset(request.imageModelPreset),
  };
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as unknown;

  if (!isToolRequest(body)) {
    return new Response(
      JSON.stringify({ type: "error", error: "Invalid generate_image request payload." }) + "\n",
      {
        status: 400,
        headers: {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
        },
      },
    );
  }

  let params: ReturnType<typeof parseGenerateImageRequest>;

  try {
    params = parseGenerateImageRequest(body);
  } catch (error) {
    return new Response(
      JSON.stringify({
        type: "error",
        error:
          error instanceof Error
            ? error.message
            : "Invalid generate_image request payload.",
      }) + "\n",
      {
        status: 400,
        headers: {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
        },
      },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (payload: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      };

      void (async () => {
        try {
          await streamGeneratedImage(params, async (event) => {
            if (event.type === "preview") {
              send({
                type: "preview",
                callId: body.callId,
                name: body.name,
                imageUrl: event.imageUrl,
              });
              return;
            }

            if (event.type === "completed") {
              send({
                type: "completed",
                callId: body.callId,
                name: body.name,
                result: event.result,
              });
              return;
            }

            send({
              type: event.type,
              callId: body.callId,
              name: body.name,
              message: event.message,
            });
          });
        } catch (error) {
          send({
            type: "error",
            callId: body.callId,
            name: body.name,
            error:
              error instanceof Error
                ? error.message
                : "Image generation failed unexpectedly.",
          });
        } finally {
          controller.close();
        }
      })();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
