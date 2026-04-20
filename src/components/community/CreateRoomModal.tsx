"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useCategorySearch } from "@/hooks/useCategorySearch";
import { Button } from "@/components/ui/button";
import { NoticeToast } from "@/components/ui/notice-toast";
import { trackEvent } from "@/lib/umami";
import { checkClientRateLimit } from "@/lib/clientRateLimit";

type CreateRoomModalProps = {
  open: boolean;
  onClose: () => void;
  sessionId: string;
  nickname: string;
  onNicknameChange: (next: string) => void;
  persistNickname: (value: string) => void;
};

const clamp = (value: number, min: number, max: number) => {
  return Math.min(Math.max(value, min), max);
};

const normalizeVoteDurationSeconds = (value: number) => {
  if (!Number.isFinite(value)) return 60;
  const normalized = Math.trunc(value);
  return normalized >= 0 ? normalized : 0;
};

const randomCode = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
};

async function insertRoomWithFallback(payload: Record<string, unknown>) {
  const base = { ...payload };
  const attempt = async (data: Record<string, unknown>) => {
    return supabase.from("rooms").insert(data).select("id, code").single();
  };

  let res = await attempt(base);
  if (!res.error) return res;

  const msg = res.error.message ?? "";
  if (msg.includes("is_public") || msg.includes("max_players")) {
    const { is_public: _, max_players: __, ...rest } = base as Record<string, unknown>;
    res = await attempt(rest);
  }
  return res;
}

export function CreateRoomModal({
  open,
  onClose,
  sessionId,
  nickname,
  onNicknameChange,
  persistNickname,
}: CreateRoomModalProps) {
  const router = useRouter();

  const [createCategory, setCreateCategory] = useState("游戏");
  const [createUndercoverCount, setCreateUndercoverCount] = useState(1);
  const [createVoteEnabled, setCreateVoteEnabled] = useState(true);
  const [createVoteDurationSeconds, setCreateVoteDurationSeconds] = useState(60);
  const [maxPlayers, setMaxPlayers] = useState(6);
  const [categorySearchOpen, setCategorySearchOpen] = useState(false);
  const [categorySearchQuery, setCategorySearchQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const { buildCategorySuggestions } = useCategorySearch();
  const categorySuggestions = useMemo(
    () => buildCategorySuggestions(categorySearchQuery),
    [buildCategorySuggestions, categorySearchQuery]
  );

  if (!open) return null;

  const createRoom = async () => {
    if (!sessionId) return;
    const trimmedNickname = nickname.trim();
    if (!trimmedNickname) {
      setError("请先输入你的昵称。");
      return;
    }

    if (!checkClientRateLimit("createRoom", 5, 60000)) {
      setError("操作过于频繁，请稍后再试。");
      return;
    }

    setBusy(true);
    setError("");

    try {
      let createdRoom: { id: string; code: string } | null = null;

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const code = randomCode();
        const roomInsert = await insertRoomWithFallback({
          code,
          host_session_id: sessionId,
          status: "lobby",
          category: createCategory.trim() || "日常",
          undercover_count: clamp(createUndercoverCount, 1, 3),
          vote_enabled: createVoteEnabled,
          round_number: 0,
          vote_round: 1,
          vote_duration_seconds: normalizeVoteDurationSeconds(createVoteDurationSeconds),
          vote_started_at: null,
          vote_deadline_at: null,
          vote_candidate_ids: null,
          is_public: true,
          max_players: clamp(maxPlayers, 3, 12),
        });

        if (roomInsert.error) {
          if (roomInsert.error.code === "23505") continue;
          throw new Error(roomInsert.error.message);
        }

        createdRoom = roomInsert.data as { id: string; code: string };
        break;
      }

      if (!createdRoom) {
        throw new Error("创建房间失败，请重试。");
      }

      const hostInsert = await supabase.from("players").insert({
        room_id: createdRoom.id,
        session_id: sessionId,
        name: trimmedNickname,
        seat_no: 1,
        is_undercover: false,
        is_alive: true,
      });

      if (hostInsert.error) {
        throw new Error(hostInsert.error.message);
      }

      persistNickname(trimmedNickname);
      trackEvent("room_created", { roomCode: createdRoom.code });
      router.push(`/room/${createdRoom.id}/lobby`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建房间失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="join-drawer-overlay" role="dialog" aria-modal="true">
      <div className="join-drawer">
        <div className="entry-form-head">
          <h2>创建公开房间</h2>
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
          人数上限（3–12）
          <input
            type="number"
            min={3}
            max={12}
            value={maxPlayers}
            onChange={(event) => setMaxPlayers(Number(event.target.value || 0))}
            disabled={busy}
          />
        </label>

        <label>
          本局类别
          <div
            className="category-picker"
            onBlur={() => {
              window.setTimeout(() => setCategorySearchOpen(false), 120);
            }}
          >
            <input
              type="text"
              className="category-picker-input"
              value={categorySearchQuery}
              onChange={(event) => {
                setCategorySearchQuery(event.target.value);
                setCreateCategory(event.target.value.trim() || createCategory);
              }}
              onFocus={() => setCategorySearchOpen(true)}
              placeholder="搜索分类..."
              disabled={busy}
            />
            {categorySearchOpen && (
              <div className="category-menu">
                <div className="category-menu-header">
                  {categorySearchQuery.trim() ? "模糊匹配结果" : "Top10 热门种类词"}
                </div>

                {categorySuggestions.length === 0 && categorySearchQuery.trim() ? (
                  <div className="category-empty">没有匹配结果，继续输入可自定义类别。</div>
                ) : (
                  categorySuggestions.map((item) => (
                    <Button
                      key={item.key}
                      type="button"
                      variant="ghost"
                      size="sm"
                      className={`category-option${createCategory === item.subcategoryDisplayName ? " active" : ""}`}
                      onClick={() => {
                        setCreateCategory(item.subcategoryDisplayName);
                        setCategorySearchQuery(item.subcategoryDisplayName);
                        setCategorySearchOpen(false);
                      }}
                    >
                      <div className="category-option-title">{item.subcategoryDisplayName}</div>
                      <div className="category-option-meta">
                        {item.categoryDisplayName}
                        {item.examples.length > 0 ? ` · 例：${item.examples.join(" vs ")}` : ""}
                        {item.usageCount > 0 ? ` · 热度 ${item.usageCount}` : ""}
                      </div>
                    </Button>
                  ))
                )}
              </div>
            )}
          </div>
        </label>

        <div className="inline-row">
          <label style={{ marginBottom: 0, flex: 1 }}>
            卧底人数
            <select
              value={createUndercoverCount}
              onChange={(event) => setCreateUndercoverCount(Number(event.target.value))}
              disabled={busy}
            >
              <option value={1}>1</option>
              <option value={2}>2</option>
              <option value={3}>3</option>
            </select>
          </label>

          <label style={{ marginBottom: 0, flex: 1 }}>
            开启投票
            <select
              value={createVoteEnabled ? "on" : "off"}
              onChange={(event) => setCreateVoteEnabled(event.target.value === "on")}
              disabled={busy}
            >
              <option value="on">是</option>
              <option value="off">否</option>
            </select>
          </label>
        </div>

        {createVoteEnabled && (
          <label>
            投票时长（秒）
            <input
              type="number"
              min={0}
              value={createVoteDurationSeconds}
              onChange={(event) => setCreateVoteDurationSeconds(Number(event.target.value || 0))}
              disabled={busy}
            />
          </label>
        )}

        <div className="actions-row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
          <Button type="button" variant="primary" size="lg" onClick={createRoom} disabled={busy}>
            {busy ? "创建中..." : "创建房间"}
          </Button>
        </div>

        <NoticeToast type="error" message={error} onClose={() => setError("")} />
      </div>
    </div>
  );
}

