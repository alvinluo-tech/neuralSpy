"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { createContext, useContext, ReactNode } from "react";
import { supabase } from "@/lib/supabase";

// Types
export type RoomRow = {
  id: string;
  code: string;
  host_session_id: string;
  status: "lobby" | "playing" | "voting" | "finished";
  category: string;
  undercover_count: number;
  vote_enabled: boolean;
  round_number: number;
  vote_round: number;
  vote_duration_seconds: number;
  vote_started_at: string | null;
  vote_deadline_at: string | null;
  vote_candidate_ids: string[] | null;
  last_eliminated_player_id: string | null;
  result_summary: string | null;
};

export type PlayerRow = {
  id: string;
  room_id: string;
  session_id: string;
  name: string;
  seat_no: number;
  is_undercover: boolean;
  is_alive: boolean;
  current_word: string | null;
};

export type VoteRow = {
  id: string;
  room_id: string;
  round_number: number;
  vote_round: number;
  voter_player_id: string;
  target_player_id: string | null;
};

// Utility functions
export const secureRandomInt = (maxExclusive: number) => {
  if (maxExclusive <= 1) return 0;
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) {
    return Math.floor(Math.random() * maxExclusive);
  }
  const maxUint32 = 4294967296;
  const threshold = Math.floor(maxUint32 / maxExclusive) * maxExclusive;
  const buffer = new Uint32Array(1);
  let value = 0;
  do {
    cryptoApi.getRandomValues(buffer);
    value = buffer[0];
  } while (value >= threshold);
  return value % maxExclusive;
};

export const undercoverKey = (ids: string[]) => {
  return [...ids].sort().join("|");
};

export const pickUndercoverIds = (
  players: PlayerRow[],
  undercoverCount: number,
  previousKey?: string,
) => {
  const pool = [...players.map((player) => player.id)];
  if (undercoverCount >= pool.length) {
    return pool;
  }

  let fallback = pool.slice(0, undercoverCount);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const shuffled = [...pool];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = secureRandomInt(i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const candidate = shuffled.slice(0, undercoverCount);
    fallback = candidate;
    if (!previousKey || undercoverKey(candidate) !== previousKey) {
      return candidate;
    }
  }

  return fallback;
};

export const detectWinner = (players: PlayerRow[]) => {
  const aliveUndercover = players.filter((player) => player.is_alive && player.is_undercover).length;
  const aliveCivilian = players.filter((player) => player.is_alive && !player.is_undercover).length;

  if (aliveUndercover === 0) return "平民" as const;
  if (aliveUndercover >= aliveCivilian) return "卧底" as const;
  return null;
};

export const clamp = (value: number, min: number, max: number) => {
  return Math.min(Math.max(value, min), max);
};

export const normalizePairKey = (pair: { civilian: string; undercover: string }) => {
  const left = pair.civilian.trim().toLowerCase();
  const right = pair.undercover.trim().toLowerCase();
  return [left, right].sort().join("||");
};

// Data loading functions
export const loadRoomData = async (roomId: string) => {
  const [roomRes, playersRes, votesRes] = await Promise.all([
    supabase
      .from("rooms")
      .select(
        "id, code, host_session_id, status, category, undercover_count, vote_enabled, round_number, vote_round, vote_duration_seconds, vote_started_at, vote_deadline_at, vote_candidate_ids, last_eliminated_player_id, result_summary"
      )
      .eq("id", roomId)
      .single(),
    supabase
      .from("players")
      .select("id, room_id, session_id, name, seat_no, is_undercover, is_alive, current_word")
      .eq("room_id", roomId)
      .order("seat_no", { ascending: true }),
    supabase
      .from("votes")
      .select("id, room_id, round_number, vote_round, voter_player_id, target_player_id")
      .eq("room_id", roomId),
  ]);

  return {
    room: (roomRes.data as RoomRow) || null,
    players: (playersRes.data as PlayerRow[]) || [],
    votes: (votesRes.data as VoteRow[]) || [],
    errors: {
      room: roomRes.error,
      players: playersRes.error,
      votes: votesRes.error,
    },
  };
};

// Subscribe to room updates
export const subscribeToRoomUpdates = (
  roomId: string,
  onUpdate: (data: { room?: RoomRow; players?: PlayerRow[]; votes?: VoteRow[] }) => void
) => {
  const channel = supabase
    .channel(`room-${roomId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "rooms", filter: `id=eq.${roomId}` },
      (payload) => {
        onUpdate({ room: payload.new as RoomRow });
      }
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "players", filter: `room_id=eq.${roomId}` },
      () => {
        loadRoomData(roomId).then((data) => {
          onUpdate({ players: data.players });
        });
      }
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "votes", filter: `room_id=eq.${roomId}` },
      () => {
        loadRoomData(roomId).then((data) => {
          onUpdate({ votes: data.votes });
        });
      }
    )
    .subscribe();

  return channel;
};

const RoomContext = createContext<{
  roomId: string | null;
  room: RoomRow | null;
  players: PlayerRow[];
  votes: VoteRow[];
  sessionId: string;
} | null>(null);

export const useRoom = () => {
  const context = useContext(RoomContext);
  if (!context) {
    throw new Error("useRoom must be used within RoomProvider");
  }
  return context;
};

export const RoomProvider = ({ children }: { children: ReactNode }) => {
  // This provider will be used if we decide to share room state across multiple components
  return <>{children}</>;
};
