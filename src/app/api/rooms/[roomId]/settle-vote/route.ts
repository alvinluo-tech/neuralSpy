import { NextRequest, NextResponse } from "next/server";
import { settleVoteRound } from "@/lib/server/settleVote";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> },
) {
  const { roomId } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    expectedRound?: number;
    expectedVoteRound?: number;
    force?: boolean;
  };

  const result = await settleVoteRound({
    roomId,
    expectedRound: body.expectedRound,
    expectedVoteRound: body.expectedVoteRound,
    force: body.force,
  });

  return NextResponse.json(result.payload, { status: result.status });
}
