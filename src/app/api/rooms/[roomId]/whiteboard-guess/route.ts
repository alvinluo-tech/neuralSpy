import { NextRequest, NextResponse } from "next/server";
import {
  detectWinnerByRole,
  isWhiteboardRole,
  sanitizeRoomSummary,
  WHITEBOARD_GUESS_PENDING_MARKER,
} from "@/lib/gameEngine";
import { getSupabaseAdmin } from "@/lib/server/supabaseAdmin";

type RoomRow = {
  id: string;
  status: "lobby" | "playing" | "voting" | "finished";
  result_summary: string | null;
  last_eliminated_player_id: string | null;
};

type PlayerRow = {
  id: string;
  room_id: string;
  name: string;
  is_undercover: boolean;
  is_alive: boolean;
  current_word: string | null;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> },
) {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { roomId } = await params;

    const body = (await request.json().catch(() => ({}))) as {
      playerId?: string;
      guess?: string;
    };

    const playerId = body.playerId?.trim();
    const guessedWord = body.guess?.trim();

    if (!playerId || !guessedWord) {
      return NextResponse.json({ error: "缺少 playerId 或 guess。" }, { status: 400 });
    }

    const roomRes = await supabaseAdmin
      .from("rooms")
      .select("id, status, result_summary, last_eliminated_player_id")
      .eq("id", roomId)
      .maybeSingle();

    if (roomRes.error) {
      return NextResponse.json({ error: roomRes.error.message }, { status: 500 });
    }

    const room = roomRes.data as RoomRow | null;
    if (!room) {
      return NextResponse.json({ error: "Room not found." }, { status: 404 });
    }

    const hasPendingGuess = (room.result_summary ?? "").includes(WHITEBOARD_GUESS_PENDING_MARKER);
    if (!hasPendingGuess || room.last_eliminated_player_id !== playerId || room.status !== "playing") {
      return NextResponse.json({ ok: true, action: "noop", reason: "not-pending" });
    }

    const playersRes = await supabaseAdmin
      .from("players")
      .select("id, room_id, name, is_undercover, is_alive, current_word")
      .eq("room_id", room.id);

    if (playersRes.error) {
      return NextResponse.json({ error: playersRes.error.message }, { status: 500 });
    }

    const players = (playersRes.data ?? []) as PlayerRow[];
    const currentPlayer = players.find((player) => player.id === playerId) ?? null;

    if (!currentPlayer) {
      return NextResponse.json({ error: "Player not found in this room." }, { status: 404 });
    }

    if (currentPlayer.is_alive || !isWhiteboardRole(currentPlayer)) {
      return NextResponse.json({ error: "仅已出局白板可以提交猜词。" }, { status: 400 });
    }

    const civilianWord =
      players.find((player) => !player.is_undercover && player.current_word !== null)?.current_word ?? null;

    if (!civilianWord) {
      return NextResponse.json({ error: "无法获取平民词。" }, { status: 500 });
    }

    const isCorrect = guessedWord.toLowerCase() === civilianWord.toLowerCase();

    if (isCorrect) {
      const summary = `${sanitizeRoomSummary(room.result_summary)} 白板玩家 ${currentPlayer.name} 猜词成功，白板单独获胜。`;
      const finishRes = await supabaseAdmin
        .from("rooms")
        .update({
          status: "finished",
          result_summary: summary,
        })
        .eq("id", room.id)
        .eq("status", "playing")
        .select("id")
        .maybeSingle();

      if (finishRes.error) {
        return NextResponse.json({ error: finishRes.error.message }, { status: 500 });
      }

      return NextResponse.json({ ok: true, action: "whiteboard-solo-win" });
    }

    const winner = detectWinnerByRole(players);
    const baseSummary = `${sanitizeRoomSummary(room.result_summary)} 白板玩家 ${currentPlayer.name} 猜词失败。`;

    const updateRes = await supabaseAdmin
      .from("rooms")
      .update({
        status: winner ? "finished" : "playing",
        result_summary: winner ? `${baseSummary} 当前胜方：${winner}阵营。` : `${baseSummary} 请继续讨论，准备下一轮投票。`,
      })
      .eq("id", room.id)
      .eq("status", "playing")
      .select("id")
      .maybeSingle();

    if (updateRes.error) {
      return NextResponse.json({ error: updateRes.error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      action: "whiteboard-guess-failed",
      winner: winner ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
