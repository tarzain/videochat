import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";

import { CLIENT_LIVE_CONFIG, DEFAULT_LIVE_MODEL, LIVE_CONNECT_CONFIG } from "@/lib/live-config";

export const runtime = "nodejs";

export async function POST() {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing GEMINI_API_KEY on the server." },
      { status: 500 },
    );
  }

  try {
    const ai = new GoogleGenAI({
      apiKey,
      apiVersion: "v1alpha",
    });

    const expireTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const newSessionExpireTime = new Date(Date.now() + 60 * 1000).toISOString();
    const token = await ai.authTokens.create({
      config: {
        uses: 1,
        expireTime,
        newSessionExpireTime,
        liveConnectConstraints: {
          model: DEFAULT_LIVE_MODEL,
          config: LIVE_CONNECT_CONFIG,
        },
      },
    });

    if (!token.name) {
      return NextResponse.json(
        { error: "Gemini did not return an ephemeral token." },
        { status: 502 },
      );
    }

    return NextResponse.json({
      token: token.name,
      clientConfig: CLIENT_LIVE_CONFIG,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to create an ephemeral Gemini token.",
      },
      { status: 500 },
    );
  }
}
