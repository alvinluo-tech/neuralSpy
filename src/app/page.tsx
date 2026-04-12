"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useCategorySearch } from "@/hooks/useCategorySearch";
import { useTrackPage } from "@/hooks/useTrackPage";
import { NoticeToast } from "@/components/ui/notice-toast";
import { identifySession, trackEvent } from "@/lib/umami";

const SESSION_KEY = "undercover.session.id";
const PLAYER_SESSION_STARTED_TRACK_PREFIX = "undercover.player.session.started.tracked.";
const randomCode = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
};
const randomSessionId = () => {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};
const clamp = (value: number, min: number, max: number) => {
  return Math.min(Math.max(value, min), max);
};

type EntryMode = "create" | "join";

export default function HomePage() {
  const router = useRouter();

  const [sessionId, setSessionId] = useState("");
  const [entryMode, setEntryMode] = useState<EntryMode | null>(null);
  const [nickname, setNickname] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [createCategory, setCreateCategory] = useState("游戏");
  const [createUndercoverCount, setCreateUndercoverCount] = useState(1);
  const [createVoteEnabled, setCreateVoteEnabled] = useState(true);
  const [createVoteDurationSeconds, setCreateVoteDurationSeconds] = useState(60);
  const [categorySearchOpen, setCategorySearchOpen] = useState(false);
  const [categorySearchQuery, setCategorySearchQuery] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Use category search hook
  const { buildCategorySuggestions } = useCategorySearch();
  const categorySuggestions = useMemo(
    () => buildCategorySuggestions(categorySearchQuery),
    [buildCategorySuggestions, categorySearchQuery],
  );

  useTrackPage("/", "Home - Entry", !!sessionId);

  // Initialize session
  useEffect(() => {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) {
      setSessionId(raw);
      return;
    }
    const newId = randomSessionId();
    localStorage.setItem(SESSION_KEY, newId);
    setSessionId(newId);
  }, []);

  // Identify session in Umami and track session start once per session id.
  useEffect(() => {
    if (!sessionId) return;

    const trimmedNickname = nickname.trim();
    identifySession(sessionId, {
      nickname: trimmedNickname || undefined,
    });

    const sessionStartKey = `${PLAYER_SESSION_STARTED_TRACK_PREFIX}${sessionId}`;
    if (sessionStorage.getItem(sessionStartKey)) return;

    trackEvent("player_session_started", {
      page: "home",
    });
    sessionStorage.setItem(sessionStartKey, "1");
  }, [sessionId, nickname]);

  const createRoom = async () => {
    if (!sessionId) return;
    if (!nickname.trim()) {
      setError("请先输入你的昵称。");
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");

    try {
      let createdRoom: { id: string; code: string } | null = null;

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const code = randomCode();
        const roomInsert = await supabase
          .from("rooms")
          .insert({
            code,
            host_session_id: sessionId,
            status: "lobby",
            category: createCategory.trim() || "日常",
            undercover_count: clamp(createUndercoverCount, 1, 3),
            vote_enabled: createVoteEnabled,
            round_number: 0,
            vote_round: 1,
            vote_duration_seconds: clamp(createVoteDurationSeconds, 15, 600),
            vote_started_at: null,
            vote_deadline_at: null,
            vote_candidate_ids: null,
          })
          .select("id, code")
          .single();

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
        name: nickname.trim(),
        seat_no: 1,
        is_undercover: false,
        is_alive: true,
      });

      if (hostInsert.error) {
        throw new Error(hostInsert.error.message);
      }

      trackEvent("room_created", { roomCode: createdRoom.code });
      router.push(`/room/${createdRoom.id}/lobby`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建房间失败");
    } finally {
      setBusy(false);
    }
  };

  const joinRoom = async () => {
    if (!sessionId) return;
    const trimmedNickname = nickname.trim();

    if (!trimmedNickname) {
      setError("请先输入你的昵称。");
      return;
    }

    const code = joinCode.trim().toUpperCase();
    if (!code) {
      setError("请输入房间邀请码。");
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");

    try {
      const roomRes = await supabase.from("rooms").select("id, code").eq("code", code).single();

      if (roomRes.error || !roomRes.data) {
        throw new Error("房间不存在，请检查邀请码。");
      }

      const targetRoomId = roomRes.data.id as string;

      const playersRes = await supabase.from("players").select("session_id, name").eq("room_id", targetRoomId);

      if (playersRes.error) {
        throw new Error(playersRes.error.message);
      }

      const normalizedInputName = trimmedNickname.toLowerCase();
      const duplicatedPlayer = (playersRes.data ?? []).find(
        (player) => player.session_id !== sessionId && player.name.trim().toLowerCase() === normalizedInputName
      );

      if (duplicatedPlayer) {
        throw new Error("该昵称在房间内已被使用，请重新设置昵称。");
      }

      const existing = await supabase
        .from("players")
        .select("id")
        .eq("room_id", targetRoomId)
        .eq("session_id", sessionId)
        .maybeSingle();

      if (existing.error) {
        throw new Error(existing.error.message);
      }

      if (!existing.data) {
        const maxSeat = await supabase
          .from("players")
          .select("seat_no")
          .eq("room_id", targetRoomId)
          .order("seat_no", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (maxSeat.error) {
          throw new Error(maxSeat.error.message);
        }

        const nextSeatNo = (maxSeat.data?.seat_no ?? 0) + 1;
        const insert = await supabase.from("players").insert({
          room_id: targetRoomId,
          session_id: sessionId,
          name: trimmedNickname,
          seat_no: nextSeatNo,
          is_undercover: false,
          is_alive: true,
        });

        if (insert.error) {
          throw new Error(insert.error.message);
        }
      }

      trackEvent("room_joined", { roomCode: code });
      router.push(`/room/${targetRoomId}/lobby`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加入房间失败");
    } finally {
      setBusy(false);
    }
  };

  if (!sessionId) {
    return (
      <div className="page-shell">
        <main className="app-wrap">
          <section className="hero-card">
            <h1 className="hero-title">初始化中...</h1>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <main className="app-wrap">
        <section className="hero-card">
          <p className="eyebrow">Realtime Room Mode</p>
          <h1 className="hero-title">谁是卧底多人房间</h1>
          <p className="hero-subtitle">
            支持多人进入同一房间。每局只调用 AI 生成 1 组词，发词后直接开玩，按轮投票并由系统公布结果。
          </p>
        </section>

        {entryMode === null && (
          <section className="panel-grid entry-choice-grid">
            <article className="panel entry-option-card">
              <h2>创建新房间</h2>
              <p className="hint">成为房主并设置类别、卧底人数和投票规则。</p>
              <button type="button" className="btn primary" onClick={() => setEntryMode("create")}>
                我来创建
              </button>
            </article>

            <article className="panel entry-option-card">
              <h2>加入已有房间</h2>
              <p className="hint">输入邀请码，快速加入朋友已经创建的房间。</p>
              <button type="button" className="btn" onClick={() => setEntryMode("join")}>
                我去加入
              </button>
            </article>
          </section>
        )}

        {entryMode === "create" && (
          <section className="panel-grid entry-grid entry-single-grid">
            <article className="panel">
              <div className="entry-form-head">
                <h2>创建房间</h2>
                <button type="button" className="btn ghost" onClick={() => setEntryMode(null)}>
                  返回选择
                </button>
              </div>

              <label>
                你的昵称
                <input
                  type="text"
                  value={nickname}
                  onChange={(event) => setNickname(event.target.value)}
                  placeholder="例如：Alex"
                />
              </label>
              <label>
                本局类别
                <div
                  style={{ position: "relative" }}
                  onBlur={() => {
                    window.setTimeout(() => setCategorySearchOpen(false), 120);
                  }}
                >
                  <input
                    type="text"
                    value={categorySearchQuery}
                    onChange={(event) => {
                      setCategorySearchQuery(event.target.value);
                      setCreateCategory(event.target.value.trim() || createCategory);
                    }}
                    onFocus={() => setCategorySearchOpen(true)}
                    placeholder="搜索分类..."
                    style={{
                      width: "100%",
                      padding: "8px",
                      border: "1px solid #ccc",
                      borderRadius: "4px",
                    }}
                  />
                  {categorySearchOpen && (
                    <div
                      style={{
                        position: "absolute",
                        top: "100%",
                        left: 0,
                        right: 0,
                        backgroundColor: "#fff",
                        border: "1px solid #ccc",
                        borderTop: "none",
                        borderRadius: "0 0 4px 4px",
                        maxHeight: "300px",
                        overflowY: "auto",
                        zIndex: 1000,
                      }}
                    >
                      <div
                        style={{
                          padding: "8px 12px",
                          fontSize: "12px",
                          color: "#777",
                          borderBottom: "1px solid #eee",
                          backgroundColor: "#fafafa",
                        }}
                      >
                        {categorySearchQuery.trim() ? "模糊匹配结果" : "Top10 热门种类词"}
                      </div>

                      {categorySuggestions.length === 0 && categorySearchQuery.trim() ? (
                        <div
                          style={{
                            padding: "10px 12px",
                            borderBottom: "1px solid #eee",
                            color: "#666",
                          }}
                        >
                          没有匹配结果，继续输入可自定义类别。
                        </div>
                      ) : (
                        categorySuggestions.map((item) => (
                          <button
                            key={item.key}
                            type="button"
                            style={{
                              width: "100%",
                              textAlign: "left",
                              padding: "8px 12px",
                              border: "none",
                              borderBottom: "1px solid #eee",
                              backgroundColor: createCategory === item.subcategoryDisplayName ? "#e8f4f8" : "#fff",
                              cursor: "pointer",
                            }}
                            onClick={() => {
                              setCreateCategory(item.subcategoryDisplayName);
                              setCategorySearchQuery(item.subcategoryDisplayName);
                              setCategorySearchOpen(false);
                            }}
                          >
                            <div style={{ fontWeight: 600 }}>{item.subcategoryDisplayName}</div>
                            <div style={{ fontSize: "12px", color: "#666" }}>
                              {item.categoryDisplayName}
                              {item.examples.length > 0 ? ` · 例：${item.examples.join(" vs ")}` : ""}
                              {item.usageCount > 0 ? ` · 热度 ${item.usageCount}` : ""}
                            </div>
                          </button>
                        ))
                      )}

                      {categorySearchQuery.trim() && (
                        <button
                          type="button"
                          style={{
                            width: "100%",
                            textAlign: "left",
                            padding: "10px 12px",
                            border: "none",
                            backgroundColor: "#f8fbff",
                            cursor: "pointer",
                            color: "#1d4ed8",
                          }}
                          onClick={() => {
                            setCreateCategory(categorySearchQuery.trim());
                            setCategorySearchOpen(false);
                          }}
                        >
                          使用“{categorySearchQuery.trim()}”作为自定义类别
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <p style={{ fontSize: "14px", color: "#666", marginTop: "4px" }}>
                  当前选择：<strong>{createCategory || "未选择"}</strong>
                </p>
              </label>
              <label>
                卧底人数（开局时随机分配）
                <input
                  type="number"
                  min={1}
                  max={3}
                  value={createUndercoverCount}
                  onChange={(event) => setCreateUndercoverCount(clamp(Number(event.target.value) || 1, 1, 3))}
                />
              </label>
              <label>
                每轮投票限时（秒）
                <input
                  type="number"
                  min={15}
                  max={600}
                  value={createVoteDurationSeconds}
                  onChange={(event) => setCreateVoteDurationSeconds(clamp(Number(event.target.value) || 15, 15, 600))}
                />
              </label>
              <label className="check-line">
                <input
                  type="checkbox"
                  checked={createVoteEnabled}
                  onChange={(event) => setCreateVoteEnabled(event.target.checked)}
                />
                启用投票功能
              </label>
              <button type="button" className="btn primary" onClick={createRoom} disabled={busy}>
                {busy ? "处理中..." : "创建房间"}
              </button>
            </article>
          </section>
        )}

        {entryMode === "join" && (
          <section className="panel-grid entry-grid entry-single-grid">
            <article className="panel">
              <div className="entry-form-head">
                <h2>加入房间</h2>
                <button type="button" className="btn ghost" onClick={() => setEntryMode(null)}>
                  返回选择
                </button>
              </div>

              <label>
                你的昵称
                <input
                  type="text"
                  value={nickname}
                  onChange={(event) => setNickname(event.target.value)}
                  placeholder="例如：Bella"
                />
              </label>
              <label>
                邀请码
                <input
                  type="text"
                  value={joinCode}
                  onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                  placeholder="例如：Q8K2MX"
                />
              </label>
              <button type="button" className="btn primary" onClick={joinRoom} disabled={busy}>
                {busy ? "处理中..." : "加入房间"}
              </button>
            </article>
          </section>
        )}

        <div className="notice-toast-stack">
          {error && <NoticeToast type="error" message={error} onClose={() => setError("")} />}
          {message && <NoticeToast type="success" message={message} onClose={() => setMessage("")} />}
        </div>
      </main>
    </div>
  );
}
