import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/supabaseAdmin";
import { settleVoteRound } from "@/lib/server/settleVote";

const isAuthorized = (request: NextRequest) => {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) return true;

  const authHeader = request.headers.get("authorization")?.trim() ?? "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const alternate = request.headers.get("x-cron-secret")?.trim() ?? "";

  return bearer === cronSecret || alternate === cronSecret;
};

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabaseAdmin = getSupabaseAdmin();
    const roomsRes = await supabaseAdmin
      .from("rooms")
      .select("id")
      .eq("status", "voting")
      .order("vote_deadline_at", { ascending: true })
      .limit(200);

    if (roomsRes.error) {
      return NextResponse.json({ error: roomsRes.error.message }, { status: 500 });
    }

    const rooms = (roomsRes.data ?? []) as Array<{ id: string }>;
    const settled: Array<{ roomId: string; action: string }> = [];
    const noop: Array<{ roomId: string; reason: string }> = [];
    const failed: Array<{ roomId: string; error: string }> = [];

    for (const room of rooms) {
      const result = await settleVoteRound({
        roomId: room.id,
        supabaseAdmin,
      });

      if (result.status >= 400) {
        failed.push({
          roomId: room.id,
          error: String(result.payload.error ?? "unknown-error"),
        });
        continue;
      }

      const action = String(result.payload.action ?? "unknown");
      if (action === "noop") {
        noop.push({
          roomId: room.id,
          reason: String(result.payload.reason ?? "noop"),
        });
        continue;
      }

      settled.push({ roomId: room.id, action });
    }

    return NextResponse.json({
      ok: true,
      processedAt: new Date().toISOString(),
      totalVotingRooms: rooms.length,
      settledCount: settled.length,
      noopCount: noop.length,
      failedCount: failed.length,
      settled,
      noop: noop.slice(0, 40),
      failed,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
