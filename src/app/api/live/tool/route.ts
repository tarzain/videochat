import { NextResponse } from "next/server";

import { generateImage } from "@/lib/image-generation";
import type { ToolCallRequest, ToolCallResponse } from "@/lib/live-types";

export const runtime = "nodejs";

function isToolRequest(input: unknown): input is ToolCallRequest {
  if (!input || typeof input !== "object") {
    return false;
  }

  const candidate = input as Partial<ToolCallRequest>;

  return (
    typeof candidate.name === "string" &&
    typeof candidate.callId === "string" &&
    "args" in candidate
  );
}

function formatCurrentTime(timeZone: string | undefined) {
  const resolvedTimeZone = timeZone && timeZone.trim() ? timeZone : "UTC";
  const formatter = new Intl.DateTimeFormat("en-US", {
    dateStyle: "full",
    timeStyle: "long",
    timeZone: resolvedTimeZone,
  });

  return {
    timeZone: resolvedTimeZone,
    now: formatter.format(new Date()),
  };
}

function getTimeResult(args: unknown) {
  const parsedArgs =
    args && typeof args === "object" ? (args as { timeZone?: unknown }) : {};

  return formatCurrentTime(
    typeof parsedArgs.timeZone === "string" ? parsedArgs.timeZone : undefined,
  );
}

async function getGenerateImageResult(request: ToolCallRequest) {
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

  return generateImage({
    contents,
    cameraSnapshot: request.cameraSnapshot,
    useCurrentCameraImage,
    referenceImageUrls: useLatestGeneratedImage ? request.referenceImageUrls : undefined,
    applyStylePrefix,
  });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as unknown;

  if (!isToolRequest(body)) {
    return NextResponse.json(
      { error: "Invalid tool request payload." },
      { status: 400 },
    );
  }

  const responseBase = {
    name: body.name,
    callId: body.callId,
  };

  if (!["get_time", "generate_image"].includes(body.name)) {
    const payload: ToolCallResponse = {
      ...responseBase,
      result: null,
      error: `Unsupported tool: ${body.name}`,
    };

    return NextResponse.json(payload, { status: 400 });
  }

  try {
    const result =
      body.name === "generate_image"
        ? await getGenerateImageResult(body)
        : getTimeResult(body.args);

    const payload: ToolCallResponse = {
      ...responseBase,
      result,
    };

    return NextResponse.json(payload);
  } catch (error) {
    const payload: ToolCallResponse = {
      ...responseBase,
      result: null,
      error:
        error instanceof Error ? error.message : "Tool execution failed unexpectedly.",
    };

    return NextResponse.json(payload, { status: 400 });
  }
}
