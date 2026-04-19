"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { NoticeToast } from "@/components/ui/notice-toast";
import { trackEvent } from "@/lib/umami";
import { checkClientRateLimit } from "@/lib/clientRateLimit";
import type { CommunityRoom } from "@/hooks/useCommunityLobbyData";

type RoomDrawerProps = {
  open: boolean;
  room: CommunityRoom | null;
  playerCount: number;
  sessionId: string;
  nickname: string;
  onNicknameChange: (next: string) => void;
  persistNickname: (value: string) => void;
  autoJoin?: boolean;
  onClose: () => void;
};

type PlayerRow = { id: string; session_id: string; name: string; seat_no: number };

function statusLabel(status: string) {
  if (status === "lobby") return "等待中";
  if (status === "playing") return "游戏中";
  if (status === "voting") return "投票中";
  if (status === "finished") return "已结束";
  return status;
}

export function RoomDrawer({
  open,
  room,
  playerCount,
  sessionId,
  nickname,
  onNicknameChange,
  persistNickname,
  autoJoin,
  onClose,
}: RoomDrawerProps) {
  const router = useRouter();
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const autoJoinRoomIdRef = useRef<string | null>(null);

  const maxPlayers = useMemo(() => {
    if (!room) return null;
    return typeof room.max_players === "number" ? room.max_players : null;
  }, [room]);

  const isFull = maxPlayers !== null ? playerCount >= maxPlayers : false;
  const isMember = useMemo(() => {
    return players.some((p) => p.session_id === sessionId);
  }, [players, sessionId]);

  useEffect(() => {
    if (!open || !room) return;

    const timer = window.setTimeout(() => {
      closeBtnRef.current?.focus();
    }, 0);

    supabase
      .from("players")
      .select("id, session_id, name, seat_no")
      .eq("room_id", room.id)
      .order("seat_no", { ascending: true })
      .then(({ data }) => {
        setPlayers(((data ?? []) as PlayerRow[]) ?? []);
      });

    return () => window.clearTimeout(timer);
  }, [open, room]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const joinRoom = async () => {
    if (!room) return;
    if (!sessionId) return;

    const trimmedNickname = nickname.trim();
    if (!trimmedNickname) {
      setError("请先输入你的昵称。");
      return;
    }

    if (!checkClientRateLimit("joinRoom", 10, 60000)) {
      setError("操作过于频繁，请稍后再试。");
      return;
    }

    setBusy(true);
    setError("");

    try {
      const roomRes = await supabase.from("rooms").select("*").eq("id", room.id).single();
      if (roomRes.error || !roomRes.data) {
        throw new Error("房间不存在或已解散。");
      }
      const latestRoom = roomRes.data as { status?: string; max_players?: number | null };
      if (latestRoom.status === "playing" || latestRoom.status === "voting") {
        throw new Error("该房间已开始游戏，请等本局结束后再加入新玩家。");
      }

      const playersRes = await supabase
        .from("players")
        .select("id, session_id, name, seat_no")
        .eq("room_id", room.id);

      if (playersRes.error) {
        throw new Error(playersRes.error.message);
      }

      const currentPlayers = (playersRes.data ?? []) as PlayerRow[];
      const latestMaxPlayers = typeof latestRoom.max_players === "number" ? latestRoom.max_players : null;
      if (latestMaxPlayers !== null && currentPlayers.length >= latestMaxPlayers) {
        throw new Error("房间人数已满，暂时无法加入。");
      }

      const normalizedInputName = trimmedNickname.toLowerCase();
      const duplicatedPlayer = currentPlayers.find(
        (player) => player.session_id !== sessionId && player.name.trim().toLowerCase() === normalizedInputName
      );

      if (duplicatedPlayer) {
        throw new Error("该昵称在房间内已被使用，请重新设置昵称。");
      }

      const existing = currentPlayers.find((player) => player.session_id === sessionId);
      if (!existing) {
        const maxSeatNo = currentPlayers.reduce((max, player) => Math.max(max, player.seat_no), 0);
        const insert = await supabase.from("players").insert({
          room_id: room.id,
          session_id: sessionId,
          name: trimmedNickname,
          seat_no: maxSeatNo + 1,
          is_undercover: false,
          is_alive: true,
        });
        if (insert.error) {
          throw new Error(insert.error.message);
        }
      }

      persistNickname(trimmedNickname);
      trackEvent("room_joined_from_community", { roomCode: room.code });
      router.push(`/room/${room.id}/lobby`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加入房间失败");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!open || !room) return;
    if (!autoJoin) return;
    if (busy) return;
    if (isMember) return;
    if (isFull) return;
    if (!nickname.trim()) return;
    if (autoJoinRoomIdRef.current === room.id) return;
    autoJoinRoomIdRef.current = room.id;
    void joinRoom();
  }, [autoJoin, busy, isFull, isMember, nickname, open, room]);

  const enterRoom = () => {
    if (!room) return;
    trackEvent("enter_room_from_community", { roomCode: room.code });
    router.push(`/room/${room.id}/lobby`);
  };

  return (
    <AnimatePresence>
      {open && room && (
        <motion.div
          className="fixed inset-0 z-[1200]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden="true" />

          <motion.aside
            className="absolute right-0 top-0 h-full w-[min(520px,100%)] border-l border-black/10 bg-[color:var(--card)] backdrop-blur-md shadow-[0_18px_42px_rgba(19,26,21,0.28)]"
            initial={{ x: 24, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 24, opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            role="dialog"
            aria-modal="true"
          >
            <div className="p-5 flex items-start justify-between gap-3 border-b border-black/10">
              <div>
                <div className="text-sm tracking-[0.14em] uppercase text-[color:var(--primary)] font-bold">
                  房间 {room.code}
                </div>
                <h2 className="m-0 mt-2 text-[1.15rem]">{room.category || "日常"}</h2>
                <p className="hint">{statusLabel(room.status)} · {playerCount}{maxPlayers ? `/${maxPlayers}` : ""}</p>
              </div>

              <Button ref={closeBtnRef} type="button" variant="ghost" onClick={onClose}>
                关闭
              </Button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto h-[calc(100%-74px)]">
              {isFull && <div className="panel" style={{ padding: 14 }}>房间人数已满，暂时无法加入。</div>}

              <div className="panel" style={{ padding: 16 }}>
                <label>
                  你的昵称
                  <input
                    type="text"
                    value={nickname}
                    onChange={(event) => onNicknameChange(event.target.value)}
                    placeholder="例如：Alex"
                    disabled={busy}
                  />
                </label>

                <div className="actions-row" style={{ justifyContent: "flex-end" }}>
                  {isMember ? (
                    <Button type="button" variant="primary" size="lg" onClick={enterRoom}>
                      进入房间
                    </Button>
                  ) : (
                    <Button type="button" variant="primary" size="lg" onClick={joinRoom} disabled={busy || isFull}>
                      {busy ? "加入中..." : "加入"}
                    </Button>
                  )}
                </div>
              </div>

              <div className="panel" style={{ padding: 16 }}>
                <h2 style={{ marginBottom: 10 }}>当前玩家</h2>
                {players.length === 0 ? (
                  <p className="hint">暂无玩家信息。</p>
                ) : (
                  <ul className="m-0 p-0 list-none grid gap-2">
                    {players.slice(0, 12).map((player) => (
                      <li key={player.id} className="flex items-center justify-between gap-2">
                        <span className="text-sm">{player.name}</span>
                        <span className="text-xs text-[color:var(--muted)]">#{player.seat_no}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <NoticeToast type="error" message={error} onClose={() => setError("")} />
            </div>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
