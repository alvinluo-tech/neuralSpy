"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { NoticeToast } from "@/components/ui/notice-toast";
import { trackEvent } from "@/lib/umami";
import { checkClientRateLimit } from "@/lib/clientRateLimit";

type InviteJoinModalProps = {
  open: boolean;
  onClose: () => void;
  sessionId: string;
  nickname: string;
  onNicknameChange: (next: string) => void;
  persistNickname: (value: string) => void;
};

const INVITE_CODE_LENGTH = 6;

export function InviteJoinModal({
  open,
  onClose,
  sessionId,
  nickname,
  onNicknameChange,
  persistNickname,
}: InviteJoinModalProps) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!open) return null;

  const joinRoom = async () => {
    if (!sessionId) return;
    const trimmedNickname = nickname.trim();
    if (!trimmedNickname) {
      setError("请先输入你的昵称。");
      return;
    }

    const normalizedCode = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (normalizedCode.length !== INVITE_CODE_LENGTH) {
      setError("请输入 6 位邀请码。");
      return;
    }

    if (!checkClientRateLimit("joinRoom", 10, 60000)) {
      setError("操作过于频繁，请稍后再试。");
      return;
    }

    setBusy(true);
    setError("");

    try {
      const roomRes = await supabase.from("rooms").select("*").eq("code", normalizedCode).single();
      if (roomRes.error || !roomRes.data) {
        throw new Error("房间不存在，请检查邀请码。");
      }

      const room = roomRes.data as { id: string; status?: string; max_players?: number | null };
      if (room.status === "playing" || room.status === "voting") {
        throw new Error("该房间已开始游戏，请等本局结束后再加入新玩家。");
      }

      const playersRes = await supabase.from("players").select("id, session_id, name, seat_no").eq("room_id", room.id);
      if (playersRes.error) {
        throw new Error(playersRes.error.message);
      }

      const players = (playersRes.data ?? []) as Array<{ id: string; session_id: string; name: string; seat_no: number }>;
      const maxPlayers = typeof room.max_players === "number" ? room.max_players : null;
      if (maxPlayers !== null && players.length >= maxPlayers) {
        throw new Error("房间人数已满，暂时无法加入。");
      }

      const normalizedInputName = trimmedNickname.toLowerCase();
      const duplicatedPlayer = players.find(
        (player) => player.session_id !== sessionId && player.name.trim().toLowerCase() === normalizedInputName
      );
      if (duplicatedPlayer) {
        throw new Error("该昵称在房间内已被使用，请重新设置昵称。");
      }

      const existing = players.find((player) => player.session_id === sessionId);
      if (!existing) {
        const maxSeatNo = players.reduce((max, player) => Math.max(max, player.seat_no), 0);
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
      trackEvent("room_joined", { roomCode: normalizedCode });
      router.push(`/room/${room.id}/lobby`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加入房间失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="join-drawer-overlay" role="dialog" aria-modal="true">
      <div className="join-drawer">
        <div className="entry-form-head">
          <h2>邀请码加入</h2>
          <Button type="button" variant="ghost" onClick={onClose}>
            关闭
          </Button>
        </div>

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

        <label>
          6 位邀请码
          <input
            type="text"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder="例如：ABC123"
            maxLength={INVITE_CODE_LENGTH}
            disabled={busy}
          />
        </label>

        <div className="actions-row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
          <Button type="button" variant="primary" size="lg" onClick={joinRoom} disabled={busy}>
            {busy ? "加入中..." : "加入房间"}
          </Button>
        </div>

        <NoticeToast type="error" message={error} onClose={() => setError("")} />
      </div>
    </div>
  );
}

