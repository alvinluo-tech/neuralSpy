"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

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

type RoomDataState = {
  room: RoomRow | null;
  players: PlayerRow[];
  votes: VoteRow[];
  loading: boolean;
  syncing: boolean;
  error: string | null;
};

export const useRoomData = (roomId: string | null) => {
  const [state, setState] = useState<RoomDataState>({
    room: null,
    players: [],
    votes: [],
    loading: false,
    syncing: false,
    error: null,
  });

  const channelRef = useRef<RealtimeChannel | null>(null);
  const fetchingRef = useRef(false);
  const pendingSilentRefreshRef = useRef(false);

  const loadRoomData = useCallback(async (targetRoomId: string, showLoading = false, showSyncing = !showLoading) => {
    if (fetchingRef.current) {
      if (!showLoading) {
        pendingSilentRefreshRef.current = true;
      }
      return;
    }

    fetchingRef.current = true;
    setState((prev) => ({
      ...prev,
      loading: showLoading ? true : prev.loading,
      syncing: showLoading ? false : showSyncing,
      error: null,
    }));

    try {
      const [roomRes, playersRes, votesRes] = await Promise.all([
        supabase
          .from("rooms")
          .select(
            "id, code, host_session_id, status, category, undercover_count, vote_enabled, round_number, vote_round, vote_duration_seconds, vote_started_at, vote_deadline_at, vote_candidate_ids, last_eliminated_player_id, result_summary"
          )
          .eq("id", targetRoomId)
          .single(),
        supabase
          .from("players")
          .select("id, room_id, session_id, name, seat_no, is_undercover, is_alive, current_word")
          .eq("room_id", targetRoomId)
          .order("seat_no", { ascending: true }),
        supabase
          .from("votes")
          .select("id, room_id, round_number, vote_round, voter_player_id, target_player_id")
          .eq("room_id", targetRoomId),
      ]);

      if (roomRes.error) {
        if (roomRes.error.code === "PGRST116") {
          setState((prev) => ({ ...prev, loading: false, error: "房间不存在或已解散" }));
          return;
        }
        throw roomRes.error;
      }

      setState((prev) => ({
        ...prev,
        room: (roomRes.data as RoomRow) || null,
        players: (playersRes.data as PlayerRow[]) || [],
        votes: (votesRes.data as VoteRow[]) || [],
        loading: false,
        syncing: false,
        error: null,
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loading: false,
        syncing: false,
        error: err instanceof Error ? err.message : "加载房间数据失败",
      }));
    } finally {
      fetchingRef.current = false;
      if (pendingSilentRefreshRef.current) {
        pendingSilentRefreshRef.current = false;
        void loadRoomData(targetRoomId, false, false);
      }
    }
  }, []);

  // 订阅房间实时更新
  useEffect(() => {
    if (!roomId) {
      // 清理订阅
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      return;
    }

    // First load shows loading state; subsequent realtime refreshes are silent.
    loadRoomData(roomId, true);

    const channel: RealtimeChannel = supabase
      .channel(`room-${roomId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rooms", filter: `id=eq.${roomId}` },
        () => loadRoomData(roomId, false, false)
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "players", filter: `room_id=eq.${roomId}` },
        () => loadRoomData(roomId, false, false)
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "votes", filter: `room_id=eq.${roomId}` },
        () => loadRoomData(roomId, false, false)
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [roomId, loadRoomData]);

  useEffect(() => {
    if (!roomId) return;

    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void loadRoomData(roomId, false, false);
    }, 2000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [roomId, loadRoomData]);

  return {
    room: state.room,
    players: state.players,
    votes: state.votes,
    loading: state.loading,
    syncing: state.syncing,
    error: state.error,
    loadRoomData,
  };
};
