import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/supabaseAdmin";

type RoomRow = {
  id: string;
  status: "lobby" | "playing" | "voting" | "finished";
  round_number: number;
  vote_round: number;
  vote_duration_seconds: number;
  vote_started_at: string | null;
  vote_deadline_at: string | null;
  vote_candidate_ids: string[] | null;
};

type PlayerRow = {
  id: string;
  seat_no: number;
  name: string;
  is_undercover: boolean;
  is_alive: boolean;
};

type VoteRow = {
  voter_player_id: string;
  target_player_id: string | null;
};

const detectWinner = (players: PlayerRow[]) => {
  const aliveUndercover = players.filter((player) => player.is_alive && player.is_undercover).length;
  const aliveCivilian = players.filter((player) => player.is_alive && !player.is_undercover).length;

  if (aliveUndercover === 0) return "平民" as const;
  if (aliveUndercover >= aliveCivilian) return "卧底" as const;
  return null;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> },
) {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { roomId } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      expectedRound?: number;
      expectedVoteRound?: number;
    };

    const roomRes = await supabaseAdmin
      .from("rooms")
      .select(
        "id, status, round_number, vote_round, vote_duration_seconds, vote_started_at, vote_deadline_at, vote_candidate_ids",
      )
      .eq("id", roomId)
      .maybeSingle();

    if (roomRes.error) {
      return NextResponse.json({ error: roomRes.error.message }, { status: 500 });
    }

    const room = roomRes.data as RoomRow | null;
    if (!room) {
      return NextResponse.json({ error: "Room not found." }, { status: 404 });
    }

    if (room.status !== "voting") {
      return NextResponse.json({ ok: true, action: "noop", reason: "not-voting" });
    }

    if (
      typeof body.expectedRound === "number" &&
      typeof body.expectedVoteRound === "number" &&
      (body.expectedRound !== room.round_number || body.expectedVoteRound !== room.vote_round)
    ) {
      return NextResponse.json({ ok: true, action: "noop", reason: "stale-client" });
    }

    const playersRes = await supabaseAdmin
      .from("players")
      .select("id, seat_no, name, is_undercover, is_alive")
      .eq("room_id", room.id);

    if (playersRes.error) {
      return NextResponse.json({ error: playersRes.error.message }, { status: 500 });
    }

    const players = (playersRes.data ?? []) as PlayerRow[];
    const alivePlayers = players.filter((player) => player.is_alive);
    const aliveSet = new Set(alivePlayers.map((player) => player.id));

    const scopeIds =
      room.vote_candidate_ids && room.vote_candidate_ids.length > 0
        ? room.vote_candidate_ids.filter((id) => aliveSet.has(id))
        : alivePlayers.map((player) => player.id);

    const scopeSet = new Set(scopeIds);
    const isTieBreakRound = scopeIds.length > 0 && scopeIds.length < alivePlayers.length;
    const voterScopeIds = isTieBreakRound
      ? alivePlayers.filter((player) => !scopeSet.has(player.id)).map((player) => player.id)
      : alivePlayers.map((player) => player.id);
    const voterScopeSet = new Set(voterScopeIds);

    const votesRes = await supabaseAdmin
      .from("votes")
      .select("voter_player_id, target_player_id")
      .eq("room_id", room.id)
      .eq("round_number", room.round_number)
      .eq("vote_round", room.vote_round);

    if (votesRes.error) {
      return NextResponse.json({ error: votesRes.error.message }, { status: 500 });
    }

    const rawVotes = (votesRes.data ?? []) as VoteRow[];
    const participationVotes = rawVotes.filter((vote) => {
      if (!voterScopeSet.has(vote.voter_player_id)) return false;
      if (vote.target_player_id === null) return true;
      return scopeSet.has(vote.target_player_id);
    });
    const countedVotes = participationVotes.filter(
      (vote): vote is VoteRow & { target_player_id: string } => vote.target_player_id !== null,
    );

    const uniqueVoters = new Set(participationVotes.map((vote) => vote.voter_player_id)).size;
    const allVoted = voterScopeIds.length > 0 && uniqueVoters >= voterScopeIds.length;
    const deadlineReached =
      !!room.vote_deadline_at && Date.now() >= Date.parse(room.vote_deadline_at);

    if (!allVoted && !deadlineReached) {
      return NextResponse.json({
        ok: true,
        action: "noop",
        reason: "waiting-for-deadline-or-all-votes",
      });
    }

    if (countedVotes.length === 0) {
      const pendingRes = await supabaseAdmin
        .from("rooms")
        .update({
          status: "playing",
          vote_round: room.vote_round + 1,
          vote_started_at: null,
          vote_deadline_at: null,
          vote_candidate_ids: scopeIds,
          result_summary: `第 ${room.vote_round} 轮无人有效投票（可能全员弃票）。请继续描述，由房主开启第 ${room.vote_round + 1} 轮投票。`,
        })
        .eq("id", room.id)
        .eq("status", "voting")
        .eq("round_number", room.round_number)
        .eq("vote_round", room.vote_round)
        .select("id")
        .maybeSingle();

      if (pendingRes.error) {
        return NextResponse.json({ error: pendingRes.error.message }, { status: 500 });
      }

      if (!pendingRes.data) {
        return NextResponse.json({ ok: true, action: "noop", reason: "already-settled" });
      }

      return NextResponse.json({ ok: true, action: "revote-no-votes-pending" });
    }

    const counter = new Map<string, number>();
    for (const vote of countedVotes) {
      counter.set(vote.target_player_id, (counter.get(vote.target_player_id) ?? 0) + 1);
    }

    const maxVote = Math.max(...counter.values());
    const candidates = Array.from(counter.entries())
      .filter(([, value]) => value === maxVote)
      .map(([key]) => key);

    if (candidates.length > 1) {
      const tiedPlayerNames = players
        .filter((player) => candidates.includes(player.id))
        .map((player) => `#${player.seat_no} ${player.name}`)
        .join("、");

      const tieRes = await supabaseAdmin
        .from("rooms")
        .update({
          status: "playing",
          vote_round: room.vote_round + 1,
          vote_started_at: null,
          vote_deadline_at: null,
          vote_candidate_ids: candidates,
          result_summary: `第 ${room.vote_round} 轮平票：${tiedPlayerNames}。请继续描述，由房主开启第 ${room.vote_round + 1} 轮加赛投票。`,
        })
        .eq("id", room.id)
        .eq("status", "voting")
        .eq("round_number", room.round_number)
        .eq("vote_round", room.vote_round)
        .select("id")
        .maybeSingle();

      if (tieRes.error) {
        return NextResponse.json({ error: tieRes.error.message }, { status: 500 });
      }

      if (!tieRes.data) {
        return NextResponse.json({ ok: true, action: "noop", reason: "already-settled" });
      }

      return NextResponse.json({ ok: true, action: "revote-tie-pending", candidates });
    }

    const eliminatedId = candidates[0];
    const eliminatedPlayer = players.find((player) => player.id === eliminatedId);
    if (!eliminatedPlayer) {
      return NextResponse.json({ error: "Eliminated player not found." }, { status: 500 });
    }

    const eliminateRes = await supabaseAdmin
      .from("players")
      .update({ is_alive: false })
      .eq("id", eliminatedId)
      .eq("is_alive", true)
      .select("id")
      .maybeSingle();

    if (eliminateRes.error) {
      return NextResponse.json({ error: eliminateRes.error.message }, { status: 500 });
    }

    if (!eliminateRes.data) {
      return NextResponse.json({ ok: true, action: "noop", reason: "already-eliminated" });
    }

    const nextPlayers = players.map((player) =>
      player.id === eliminatedId ? { ...player, is_alive: false } : player,
    );

    const winner = detectWinner(nextPlayers);
    const summary = `第 ${room.vote_round} 轮：玩家 ${eliminatedPlayer.seat_no}（${eliminatedPlayer.name}）出局。`;

    if (winner) {
      const finishRes = await supabaseAdmin
        .from("rooms")
        .update({
          status: "finished",
          vote_started_at: null,
          vote_deadline_at: null,
          vote_candidate_ids: null,
          last_eliminated_player_id: eliminatedId,
          result_summary: `${summary} 最终胜方：${winner}阵营。`,
        })
        .eq("id", room.id)
        .eq("status", "voting")
        .eq("round_number", room.round_number)
        .select("id")
        .maybeSingle();

      if (finishRes.error) {
        return NextResponse.json({ error: finishRes.error.message }, { status: 500 });
      }

      return NextResponse.json({ ok: true, action: "finished", winner });
    }

    const continueRes = await supabaseAdmin
      .from("rooms")
      .update({
        status: "playing",
        vote_round: room.vote_round + 1,
        vote_started_at: null,
        vote_deadline_at: null,
        vote_candidate_ids: null,
        last_eliminated_player_id: eliminatedId,
        result_summary: `${summary} 请继续讨论，准备下一轮投票。`,
      })
      .eq("id", room.id)
      .eq("status", "voting")
      .eq("round_number", room.round_number)
      .select("id")
      .maybeSingle();

    if (continueRes.error) {
      return NextResponse.json({ error: continueRes.error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, action: "eliminated", eliminatedId });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
