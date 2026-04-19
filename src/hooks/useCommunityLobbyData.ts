"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export type CommunityRoom = {
  id: string;
  code: string;
  host_session_id: string;
  status: "lobby" | "playing" | "voting" | "finished" | string;
  category?: string | null;
  created_at?: string;
  is_public?: boolean | null;
  max_players?: number | null;
};

type LobbyState = {
  rooms: CommunityRoom[];
  playerCounts: Record<string, number>;
  loading: boolean;
  syncing: boolean;
  error: string | null;
  updatedAtMs: number;
};

function isRoomPublic(room: CommunityRoom): boolean {
  if (Object.prototype.hasOwnProperty.call(room, "is_public")) {
    return room.is_public !== false;
  }
  return true;
}

const ROOM_VISIBILITY_WINDOW_MS = 6 * 60 * 60 * 1000;

function parseCreatedAtMs(value: string | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function shouldShowRoom(room: CommunityRoom, nowMs: number): boolean {
  if (!isRoomPublic(room)) return false;
  if (room.status !== "lobby") return false;
  const createdAtMs = parseCreatedAtMs(room.created_at);
  if (createdAtMs === null) return true;
  return nowMs - createdAtMs <= ROOM_VISIBILITY_WINDOW_MS;
}

function upsertRoom(list: CommunityRoom[], room: CommunityRoom): CommunityRoom[] {
  const idx = list.findIndex((item) => item.id === room.id);
  if (idx === -1) return [room, ...list];
  const next = [...list];
  next[idx] = room;
  return next;
}

function removeRoom(list: CommunityRoom[], roomId: string): CommunityRoom[] {
  return list.filter((item) => item.id !== roomId);
}

function calcPlayerCounts(roomIds: string[], playerRows: Array<{ room_id: string }>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const id of roomIds) counts[id] = 0;
  for (const row of playerRows) {
    if (!counts[row.room_id]) counts[row.room_id] = 0;
    counts[row.room_id] += 1;
  }
  return counts;
}

export function useCommunityLobbyData() {
  const [state, setState] = useState<LobbyState>({
    rooms: [],
    playerCounts: {},
    loading: false,
    syncing: false,
    error: null,
    updatedAtMs: Date.now(),
  });

  const channelRef = useRef<RealtimeChannel | null>(null);
  const fetchingRef = useRef(false);

  const publicRooms = useMemo(() => {
    const nowMs = Date.now();
    return state.rooms.filter((room) => shouldShowRoom(room, nowMs));
  }, [state.rooms]);
  const totalPlayers = useMemo(() => {
    return publicRooms.reduce((sum, room) => sum + (state.playerCounts[room.id] ?? 0), 0);
  }, [publicRooms, state.playerCounts]);

  const refresh = useCallback(async (showLoading = false) => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;

    setState((prev) => ({
      ...prev,
      loading: showLoading ? true : prev.loading,
      syncing: showLoading ? false : true,
      error: null,
    }));

    try {
      const nowMs = Date.now();
      const tryQuery = async (withPublicFields: boolean) => {
        const baseSelect = withPublicFields
          ? "id, code, host_session_id, status, category, created_at, is_public, max_players"
          : "id, code, host_session_id, status, category, created_at";

        let query = supabase
          .from("rooms")
          .select(baseSelect)
          .eq("status", "lobby")
          .order("created_at", { ascending: false })
          .limit(80);

        if (withPublicFields) {
          query = query.eq("is_public", true);
        }

        return query;
      };

      let roomsRes = await tryQuery(true);
      if (roomsRes.error) {
        const msg = roomsRes.error.message ?? "";
        if (msg.includes("is_public") || msg.includes("max_players")) {
          roomsRes = await tryQuery(false);
        }
      }

      if (roomsRes.error) {
        throw new Error(roomsRes.error.message);
      }

      const rooms = ((roomsRes.data ?? []) as unknown as CommunityRoom[]).filter((room) =>
        shouldShowRoom(room, nowMs)
      );
      const roomIds = rooms.map((room) => room.id);
      let playerCounts: Record<string, number> = {};

      if (roomIds.length > 0) {
        const playersRes = await supabase.from("players").select("room_id").in("room_id", roomIds);
        if (playersRes.error) {
          throw new Error(playersRes.error.message);
        }
        playerCounts = calcPlayerCounts(
          roomIds,
          (playersRes.data ?? []) as unknown as Array<{ room_id: string }>
        );
      }

      setState((prev) => ({
        ...prev,
        rooms,
        playerCounts,
        loading: false,
        syncing: false,
        error: null,
        updatedAtMs: nowMs,
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loading: false,
        syncing: false,
        error: err instanceof Error ? err.message : "加载大厅数据失败",
        updatedAtMs: Date.now(),
      }));
    } finally {
      fetchingRef.current = false;
    }
  }, []);

  useEffect(() => {
    refresh(true);

    const channel = supabase
      .channel("community-lobby")
      .on("postgres_changes", { event: "*", schema: "public", table: "rooms" }, (payload) => {
        setState((prev) => {
          const nextUpdatedAtMs = Date.now();
          const eventType = payload.eventType;
          if (eventType === "INSERT") {
            const room = payload.new as CommunityRoom;
            if (!shouldShowRoom(room, nextUpdatedAtMs)) {
              return {
                ...prev,
                rooms: removeRoom(prev.rooms, room.id),
                updatedAtMs: nextUpdatedAtMs,
              };
            }
            return {
              ...prev,
              rooms: upsertRoom(prev.rooms, room),
              updatedAtMs: nextUpdatedAtMs,
            };
          }

          if (eventType === "UPDATE") {
            const room = payload.new as CommunityRoom;
            if (!shouldShowRoom(room, nextUpdatedAtMs)) {
              const { [room.id]: _, ...restCounts } = prev.playerCounts;
              return {
                ...prev,
                rooms: removeRoom(prev.rooms, room.id),
                playerCounts: restCounts,
                updatedAtMs: nextUpdatedAtMs,
              };
            }
            return {
              ...prev,
              rooms: upsertRoom(prev.rooms, room),
              updatedAtMs: nextUpdatedAtMs,
            };
          }

          if (eventType === "DELETE") {
            const room = payload.old as { id?: string };
            const roomId = room?.id;
            if (!roomId) return { ...prev, updatedAtMs: nextUpdatedAtMs };
            const { [roomId]: _, ...restCounts } = prev.playerCounts;
            return {
              ...prev,
              rooms: removeRoom(prev.rooms, roomId),
              playerCounts: restCounts,
              updatedAtMs: nextUpdatedAtMs,
            };
          }

          return { ...prev, updatedAtMs: nextUpdatedAtMs };
        });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "players" }, (payload) => {
        setState((prev) => {
          const nextUpdatedAtMs = Date.now();
          const eventType = payload.eventType;
          if (eventType === "INSERT") {
            const roomId = (payload.new as { room_id?: string })?.room_id;
            if (!roomId) return { ...prev, updatedAtMs: nextUpdatedAtMs };
            return {
              ...prev,
              playerCounts: {
                ...prev.playerCounts,
                [roomId]: (prev.playerCounts[roomId] ?? 0) + 1,
              },
              updatedAtMs: nextUpdatedAtMs,
            };
          }

          if (eventType === "DELETE") {
            const roomId = (payload.old as { room_id?: string })?.room_id;
            if (!roomId) return { ...prev, updatedAtMs: nextUpdatedAtMs };
            const nextCount = Math.max(0, (prev.playerCounts[roomId] ?? 0) - 1);
            const room = prev.rooms.find((item) => item.id === roomId);
            if (room && nextCount === 0 && !shouldShowRoom(room, nextUpdatedAtMs)) {
              const { [roomId]: _, ...restCounts } = prev.playerCounts;
              return {
                ...prev,
                rooms: removeRoom(prev.rooms, roomId),
                playerCounts: restCounts,
                updatedAtMs: nextUpdatedAtMs,
              };
            }

            return {
              ...prev,
              playerCounts: {
                ...prev.playerCounts,
                [roomId]: nextCount,
              },
              updatedAtMs: nextUpdatedAtMs,
            };
          }

          if (eventType === "UPDATE") {
            const oldRoomId = (payload.old as { room_id?: string })?.room_id;
            const newRoomId = (payload.new as { room_id?: string })?.room_id;
            if (!oldRoomId || !newRoomId || oldRoomId === newRoomId) {
              return { ...prev, updatedAtMs: nextUpdatedAtMs };
            }
            return {
              ...prev,
              playerCounts: {
                ...prev.playerCounts,
                [oldRoomId]: Math.max(0, (prev.playerCounts[oldRoomId] ?? 0) - 1),
                [newRoomId]: (prev.playerCounts[newRoomId] ?? 0) + 1,
              },
              updatedAtMs: nextUpdatedAtMs,
            };
          }

          return { ...prev, updatedAtMs: nextUpdatedAtMs };
        });
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [refresh]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void refresh(false);
    }, 60000);

    return () => window.clearInterval(intervalId);
  }, [refresh]);

  return {
    rooms: publicRooms,
    playerCounts: state.playerCounts,
    totalPlayers,
    loading: state.loading,
    syncing: state.syncing,
    error: state.error,
    updatedAtMs: state.updatedAtMs,
    refresh,
  };
}
