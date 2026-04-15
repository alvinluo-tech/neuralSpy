"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { supabase } from "@/lib/supabase";
import { useCategorySearch } from "@/hooks/useCategorySearch";
import { useTrackPage } from "@/hooks/useTrackPage";
import { Button } from "@/components/ui/button";
import { NoticeToast } from "@/components/ui/notice-toast";
import { identifySession, trackEvent } from "@/lib/umami";

const SESSION_KEY = "undercover.session.id";
const PLAYER_SESSION_STARTED_TRACK_PREFIX = "undercover.player.session.started.tracked.";
const INVITE_CODE_LENGTH = 6;
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

const normalizeVoteDurationSeconds = (value: number) => {
  if (!Number.isFinite(value)) return 60;
  const normalized = Math.trunc(value);
  return normalized >= 0 ? normalized : 0;
};

const safeGetSessionValue = (key: string) => {
  try {
    return sessionStorage.getItem(key);
  } catch {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }
};

const safeSetSessionValue = (key: string, value: string) => {
  try {
    sessionStorage.setItem(key, value);
    return;
  } catch {}

  try {
    localStorage.setItem(key, value);
  } catch {}
};

type EntryMode = "create" | "join";

const HOME_FLOW_STEPS = [
  { label: "选择方式", step: 1 },
  { label: "填写信息", step: 2 },
  { label: "进入房间", step: 3 },
] as const;

export default function HomePage() {
  const router = useRouter();
  const joinCodeInputRefs = useRef<Array<HTMLInputElement | null>>([]);

  const [sessionId, setSessionId] = useState("");
  const [entryMode, setEntryMode] = useState<EntryMode | null>(null);
  const [nickname, setNickname] = useState("");
  const [joinCodeSlots, setJoinCodeSlots] = useState<string[]>(() =>
    Array.from({ length: INVITE_CODE_LENGTH }, () => "")
  );
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
  const joinCode = joinCodeSlots.join("");
  const trimmedNickname = nickname.trim();
  const isCreateReady =
    trimmedNickname.length > 0 &&
    createCategory.trim().length > 0 &&
    (!createVoteEnabled || normalizeVoteDurationSeconds(createVoteDurationSeconds) >= 0);
  const isJoinReady = trimmedNickname.length > 0 && joinCode.length === INVITE_CODE_LENGTH;

  let flowModeLabel = "未选择";
  let flowCompletedStep = 0;
  let flowCurrentStep = 1;
  let flowNextAction = "请选择“创建”或“加入”开始。";

  if (entryMode === "create") {
    flowModeLabel = "创建模式";
    flowCompletedStep = 1;
    flowCurrentStep = 2;
    flowNextAction = "填写昵称与规则后，点击“创建房间”。";

    if (isCreateReady) {
      flowCompletedStep = 2;
      flowCurrentStep = 3;
      flowNextAction = "信息已就绪，点击“创建房间”进入大厅。";
    }
  } else if (entryMode === "join") {
    flowModeLabel = "加入模式";
    flowCompletedStep = 1;
    flowCurrentStep = 2;
    flowNextAction = "填写昵称和 6 位邀请码后点击“加入房间”。";

    if (isJoinReady) {
      flowCompletedStep = 2;
      flowCurrentStep = 3;
      flowNextAction = "信息已就绪，点击“加入房间”进入大厅。";
    }
  }

  if (busy) {
    flowCurrentStep = 3;
    flowNextAction = "正在处理，请稍候...";
  }

  const focusJoinCodeInput = (index: number) => {
    const target = joinCodeInputRefs.current[index];
    if (!target) return;
    target.focus();
    target.select();
  };

  const resetJoinCodeSlots = () => {
    setJoinCodeSlots(Array.from({ length: INVITE_CODE_LENGTH }, () => ""));
  };

  const handleJoinCodeInput = (index: number, rawValue: string) => {
    const normalized = rawValue.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const nextChar = normalized.slice(-1);

    setJoinCodeSlots((prev) => {
      const next = [...prev];
      next[index] = nextChar;
      return next;
    });

    if (nextChar && index < INVITE_CODE_LENGTH - 1) {
      focusJoinCodeInput(index + 1);
    }
  };

  const handleJoinCodeKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Backspace") {
      event.preventDefault();
      setJoinCodeSlots((prev) => {
        const next = [...prev];
        if (next[index]) {
          next[index] = "";
          return next;
        }
        if (index > 0) {
          next[index - 1] = "";
          window.setTimeout(() => focusJoinCodeInput(index - 1), 0);
        }
        return next;
      });
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (index > 0) focusJoinCodeInput(index - 1);
      return;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      if (index < INVITE_CODE_LENGTH - 1) focusJoinCodeInput(index + 1);
    }
  };

  const handleJoinCodePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    const pasted = event.clipboardData
      .getData("text")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, INVITE_CODE_LENGTH)
      .split("");

    setJoinCodeSlots(
      Array.from({ length: INVITE_CODE_LENGTH }, (_, index) => pasted[index] ?? "")
    );

    const nextFocusIndex = Math.min(pasted.length, INVITE_CODE_LENGTH - 1);
    window.setTimeout(() => focusJoinCodeInput(nextFocusIndex), 0);
  };

  useEffect(() => {
    if (entryMode !== "join") return;
    const firstEmptyIndex = joinCodeSlots.findIndex((char) => !char);
    const targetIndex = firstEmptyIndex === -1 ? INVITE_CODE_LENGTH - 1 : firstEmptyIndex;
    const timer = window.setTimeout(() => focusJoinCodeInput(targetIndex), 0);
    return () => window.clearTimeout(timer);
  }, [entryMode, joinCodeSlots]);

  useTrackPage("/", "Home - Entry", !!sessionId);

  // Initialize session
  useEffect(() => {
    const raw = safeGetSessionValue(SESSION_KEY);
    if (raw) {
      setSessionId(raw);
      return;
    }
    const newId = randomSessionId();
    safeSetSessionValue(SESSION_KEY, newId);
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
    if (safeGetSessionValue(sessionStartKey)) return;

    trackEvent("player_session_started", {
      page: "home",
    });
    safeSetSessionValue(sessionStartKey, "1");
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
            vote_duration_seconds: normalizeVoteDurationSeconds(createVoteDurationSeconds),
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

    if (code.length !== INVITE_CODE_LENGTH) {
      setError("请输入 6 位邀请码。");
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

        <section className="panel home-flow-panel">
          <div className="home-flow-head">
            <h2>开局流程</h2>
            <span className="status-pill">当前模式：{flowModeLabel}</span>
          </div>
          <ol className="home-flow-steps" aria-label="大厅流程步骤预览">
            {HOME_FLOW_STEPS.map((item, index) => {
              const state =
                item.step <= flowCompletedStep ? "done" : flowCurrentStep === item.step ? "current" : "todo";

              return (
                <li className="home-flow-item" key={item.step}>
                  <span className={`home-flow-dot ${state}`}>{item.step <= flowCompletedStep ? "OK" : item.step}</span>
                  <span className={`home-flow-label ${state}`}>{item.label}</span>
                  {index < HOME_FLOW_STEPS.length - 1 && <span className="home-flow-arrow">→</span>}
                </li>
              );
            })}
          </ol>
          <p className="hint">下一步：{flowNextAction}</p>
        </section>

        {entryMode === null && (
          <section className="entry-cta-stack">
            <article className="panel entry-option-card entry-option-primary">
              <h2>创建新房间</h2>
              <p className="hint">成为房主并设置类别、卧底人数和投票规则。</p>
              <Button type="button" variant="primary" size="lg" onClick={() => setEntryMode("create")}>
                我来创建
              </Button>
            </article>

            <div className="entry-cta-divider" aria-hidden="true">
              <span>或者</span>
            </div>

            <article className="panel entry-option-card entry-option-secondary">
              <h2>加入已有房间</h2>
              <p className="hint">输入邀请码，快速加入朋友已经创建的房间。</p>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  resetJoinCodeSlots();
                  setEntryMode("join");
                }}
              >
                我去加入
              </Button>
            </article>
          </section>
        )}

        {entryMode === "create" && (
          <section className="panel-grid entry-grid entry-single-grid">
            <article className="panel">
              <div className="entry-form-head">
                <h2>创建房间</h2>
                <Button type="button" variant="ghost" onClick={() => setEntryMode(null)}>
                  返回选择
                </Button>
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
                  />
                  {categorySearchOpen && (
                    <div className="category-menu">
                      <div className="category-menu-header">
                        {categorySearchQuery.trim() ? "模糊匹配结果" : "Top10 热门种类词"}
                      </div>

                      {categorySuggestions.length === 0 && categorySearchQuery.trim() ? (
                        <div className="category-empty">
                          没有匹配结果，继续输入可自定义类别。
                        </div>
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

                      {categorySearchQuery.trim() && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="category-option custom"
                          onClick={() => {
                            setCreateCategory(categorySearchQuery.trim());
                            setCategorySearchOpen(false);
                          }}
                        >
                          使用“{categorySearchQuery.trim()}”作为自定义类别
                        </Button>
                      )}
                    </div>
                  )}
                </div>
                <p className="category-current">
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
              <label className="check-line">
                <input
                  type="checkbox"
                  checked={createVoteEnabled}
                  onChange={(event) => setCreateVoteEnabled(event.target.checked)}
                />
                启用投票功能
              </label>
              <AnimatePresence initial={false}>
                {createVoteEnabled && (
                  <motion.div
                    key="vote-duration-field"
                    initial={{ opacity: 0, y: -8, height: 0 }}
                    animate={{ opacity: 1, y: 0, height: "auto" }}
                    exit={{ opacity: 0, y: -8, height: 0 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                    className="motion-collapse"
                  >
                    <label>
                      每轮投票限时（秒）
                      <input
                        type="number"
                        min={0}
                        value={createVoteDurationSeconds}
                        onChange={(event) =>
                          setCreateVoteDurationSeconds(normalizeVoteDurationSeconds(Number(event.target.value)))
                        }
                      />
                    </label>
                  </motion.div>
                )}
              </AnimatePresence>
              <Button
                type="button"
                variant="primary"
                className={busy ? "loading" : undefined}
                onClick={createRoom}
                disabled={busy}
              >
                {busy ? "处理中..." : "创建房间"}
              </Button>
            </article>
          </section>
        )}

        {entryMode === "join" && (
          <div
            className="join-drawer-overlay"
            onClick={() => {
              if (busy) return;
              setEntryMode(null);
            }}
          >
            <section className="join-drawer" onClick={(event) => event.stopPropagation()}>
              <div className="join-drawer-handle" aria-hidden="true" />
              <div className="entry-form-head">
                <h2>加入房间</h2>
                <Button type="button" variant="ghost" onClick={() => setEntryMode(null)} disabled={busy}>
                  返回
                </Button>
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
                <div className="invite-code-grid" onPaste={handleJoinCodePaste}>
                  {joinCodeSlots.map((char, index) => (
                    <input
                      key={`invite-slot-${index}`}
                      ref={(element) => {
                        joinCodeInputRefs.current[index] = element;
                      }}
                      type="text"
                      className={`invite-code-cell${char ? " filled" : ""}`}
                      inputMode="text"
                      autoComplete="one-time-code"
                      maxLength={1}
                      value={char}
                      onChange={(event) => handleJoinCodeInput(index, event.target.value)}
                      onKeyDown={(event) => handleJoinCodeKeyDown(index, event)}
                      aria-label={`邀请码第 ${index + 1} 位`}
                    />
                  ))}
                </div>
                <p className="hint">请输入 6 位邀请码（字母或数字）。</p>
              </label>

              <Button
                type="button"
                variant="primary"
                className={busy ? "loading" : undefined}
                onClick={joinRoom}
                disabled={busy}
              >
                {busy ? "处理中..." : "加入房间"}
              </Button>
            </section>
          </div>
        )}

        <div className="notice-toast-stack">
          {error && <NoticeToast type="error" message={error} onClose={() => setError("")} />}
          {message && <NoticeToast type="success" message={message} onClose={() => setMessage("")} />}
        </div>
      </main>
    </div>
  );
}
