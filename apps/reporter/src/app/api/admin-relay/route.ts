import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Server-side proxy for privileged admin relay actions.
 *
 * The browser cannot read RELAY_API_KEY (no NEXT_PUBLIC_ prefix), so the
 * client calls this route instead of /api/relay directly.  This route
 * reads the secret from the server environment, injects it as the
 * x-api-key header, and forwards the request to /api/relay.
 */
export async function POST(req: NextRequest) {
    const relayApiKey = process.env.RELAY_API_KEY;
    if (!relayApiKey) {
        return NextResponse.json(
            { error: "Server misconfiguration — RELAY_API_KEY not set. Contact administrator." },
            { status: 500 }
        );
    }

    let body: unknown;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    // Build the internal relay URL using the same host/origin so this works
    // both locally (localhost:3000) and in production (Vercel, etc.).
    const origin = req.nextUrl.origin;
    const relayUrl = `${origin}/api/relay`;

    const relayRes = await fetch(relayUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": relayApiKey,
        },
        body: JSON.stringify(body),
    });

    const data = await relayRes.json().catch(() => ({}));
    return NextResponse.json(data, { status: relayRes.status });
}
