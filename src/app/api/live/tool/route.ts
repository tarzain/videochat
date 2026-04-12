import { NextResponse } from "next/server";

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

  if (body.name !== "get_time") {
    const payload: ToolCallResponse = {
      ...responseBase,
      result: null,
      error: `Unsupported tool: ${body.name}`,
    };

    return NextResponse.json(payload, { status: 400 });
  }

  const args =
    body.args && typeof body.args === "object"
      ? (body.args as { timeZone?: unknown })
      : {};

  try {
    const result = formatCurrentTime(
      typeof args.timeZone === "string" ? args.timeZone : undefined,
    );

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
