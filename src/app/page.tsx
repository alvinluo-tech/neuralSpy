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
import { checkClientRateLimit } from "@/lib/clientRateLimit";
import { CreateRoomForm, type CreateRoomData } from "@/components/rooms/CreateRoomForm";
import { JoinRoomForm, INVITE_CODE_LENGTH } from "@/components/rooms/JoinRoomForm";
import { MIN_ROOM_PLAYERS, MAX_ROOM_PLAYERS, DEFAULT_ROOM_MAX_PLAYERS } from "@/lib/constants";
import { clamp } from "@/lib/utils";

const SESSION_KEY = "undercover.session.id";
const PLAYER_NICKNAME_KEY = "undercover.lastNickname";
const PLAYER_SESSION_STARTED_TRACK_PREFIX = "undercover.player.session.started.tracked.";
const randomCode = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
};
const randomSessionId = () => {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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
  const [createIsPublic, setCreateIsPublic] = useState(false);
  const [joinCodeSlots, setJoinCodeSlots] = useState<string[]>(() =>
    Array.from({ length: INVITE_CODE_LENGTH }, () => "")
  );
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const joinCode = joinCodeSlots.join("");
  const trimmedNickname = nickname.trim();
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
    if (firstEmptyIndex === -1) {
      // Code is fully pre-filled, focus the nickname input instead
      const nicknameInput = document.getElementById("join-nickname-input");
      if (nicknameInput) {
        const timer = window.setTimeout(() => nicknameInput.focus(), 0);
        return () => window.clearTimeout(timer);
      }
      return;
    }
    const targetIndex = firstEmptyIndex;
    const timer = window.setTimeout(() => focusJoinCodeInput(targetIndex), 0);
    return () => window.clearTimeout(timer);
  }, [entryMode, joinCodeSlots]);

  useTrackPage("/", "Home - Entry", !!sessionId);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const urlParams = new URLSearchParams(window.location.search);
      const codeParam = urlParams.get("joinCode");
      const modeParam = urlParams.get("mode");
      const publicParam = urlParams.get("public");
      let shouldCleanUrl = false;

      if (modeParam === "create") {
        setEntryMode("create");
        setCreateIsPublic(publicParam === "1");
        shouldCleanUrl = true;
      }

      if (modeParam === "join") {
        resetJoinCodeSlots();
        setEntryMode("join");
        shouldCleanUrl = true;
      }

      if (codeParam) {
        const cleaned = codeParam.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, INVITE_CODE_LENGTH);
        if (cleaned.length > 0) {
          const newSlots = Array.from({ length: INVITE_CODE_LENGTH }, (_, i) => cleaned[i] || "");
          setJoinCodeSlots(newSlots);
          setEntryMode("join");
          shouldCleanUrl = true;
          
          supabase
            .from("rooms")
            .select("status")
            .eq("code", cleaned)
            .single()
            .then(({ data, error: fetchError }) => {
              if (fetchError || !data) {
                setError("邀请码对应的房间不存在或已解散。");
              } else if (data.status === "playing" || data.status === "voting") {
                setError("该房间已开始游戏，请等本局结束后再加入。");
              }
            });
          
        }
      }

      if (shouldCleanUrl) {
        const newUrl = window.location.pathname;
        window.history.replaceState({}, "", newUrl);
      }
    }
  }, []);

  // Initialize session and nickname
  useEffect(() => {
    const rawSession = safeGetSessionValue(SESSION_KEY);
    if (rawSession) {
      setSessionId(rawSession);
    } else {
      const newId = randomSessionId();
      safeSetSessionValue(SESSION_KEY, newId);
      setSessionId(newId);
    }

    const lastNickname = safeGetSessionValue(PLAYER_NICKNAME_KEY);
    if (lastNickname) {
      setNickname(lastNickname);
    }
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

  const handleCreateSubmit = async (data: CreateRoomData) => {
    if (!sessionId) return;
    const trimmedNickname = data.nickname.trim();

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
            category: data.category.trim() || "日常",
            undercover_count: data.undercoverCount,
            max_players: data.maxPlayers,
            is_public: data.isPublic,
            vote_enabled: data.voteEnabled,
            round_number: 0,
            vote_round: 1,
            vote_duration_seconds: data.voteDurationSeconds,
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
        name: trimmedNickname,
        seat_no: 1,
        is_undercover: false,
        is_alive: true,
      });

      if (hostInsert.error) {
        throw new Error(hostInsert.error.message);
      }

      safeSetSessionValue(PLAYER_NICKNAME_KEY, trimmedNickname);
      setNickname(trimmedNickname); // update local state
      trackEvent("room_created", { roomCode: createdRoom.code });
      router.push(`/room/${createdRoom.id}/lobby`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建房间失败");
      setBusy(false);
    }
  };

  const handleJoinSubmit = async (submitNickname: string, submitCode: string) => {
    if (!sessionId) return;
    const trimmedNickname = submitNickname.trim();

    if (!trimmedNickname) {
      setError("请先输入你的昵称。");
      return;
    }

    const code = submitCode.trim().toUpperCase();
    if (!code) {
      setError("请输入房间邀请码。");
      return;
    }

    if (code.length !== INVITE_CODE_LENGTH) {
      setError(`请输入 ${INVITE_CODE_LENGTH} 位邀请码。`);
      return;
    }

    if (!checkClientRateLimit("joinRoom", 10, 60000)) {
      setError("操作过于频繁，请稍后再试。");
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");

    try {
      const roomRes = await supabase.from("rooms").select("id, code, status, max_players").eq("code", code).single();

      if (roomRes.error || !roomRes.data) {
        throw new Error("房间不存在，请检查邀请码。");
      }

      const targetRoomId = roomRes.data.id as string;
      const roomStatus = roomRes.data.status as string;
      const maxPlayers =
        typeof (roomRes.data as { max_players?: unknown }).max_players === "number"
          ? ((roomRes.data as { max_players: number }).max_players ?? DEFAULT_ROOM_MAX_PLAYERS)
          : DEFAULT_ROOM_MAX_PLAYERS;

      const playersRes = await supabase.from("players").select("session_id, name").eq("room_id", targetRoomId);

      if (playersRes.error) {
        throw new Error(playersRes.error.message);
      }

      const currentPlayersCount = (playersRes.data ?? []).length;

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
        if (roomStatus === "playing" || roomStatus === "voting") {
          throw new Error("该房间已开始游戏，请等本局结束后再加入新玩家。");
        }

        if (currentPlayersCount >= maxPlayers) {
          throw new Error("房间人数已满，无法加入。");
        }

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

      safeSetSessionValue(PLAYER_NICKNAME_KEY, trimmedNickname);
      setNickname(trimmedNickname); // update local state
      trackEvent("room_joined", { roomCode: code });
      router.push(`/room/${targetRoomId}/lobby`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加入房间失败");
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
      <main className="app-wrap aceternity-stage">
        <section className="panel" style={{ padding: 14 }}>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="text-sm tracking-[0.14em] uppercase text-[color:var(--primary)] font-bold">
                Community
              </div>
              <div className="text-sm text-[color:var(--muted)] mt-1">想快速加入路人的房间？去社区大厅看看。</div>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                trackEvent("home_go_community_clicked");
                router.push("/community");
              }}
            >
              去社区大厅
            </Button>
          </div>
        </section>

        <motion.section
          className="hero-card hero-card--lift acet-spotlight"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.42, ease: "easeOut" }}
        >
          <p className="eyebrow">Realtime Room Mode</p>
          <h1 className="hero-title">谁是卧底多人房间</h1>
          <p className="hero-subtitle">
            支持多人进入同一房间。每局只调用 AI 生成 1 组词，发词后直接开玩，按轮投票并由系统公布结果。
          </p>
        </motion.section>

        <motion.section
          className="panel home-flow-panel acet-card-lift"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.42, delay: 0.06, ease: "easeOut" }}
        >
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
        </motion.section>

        {entryMode === null && (
          <motion.section
            className="entry-cta-stack"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.42, delay: 0.12, ease: "easeOut" }}
          >
            <article className="panel entry-option-card entry-option-primary acet-card-lift">
              <h2>创建新房间</h2>
              <p className="hint">成为房主并设置类别、卧底人数和投票规则。</p>
              <Button
                type="button"
                variant="primary"
                size="lg"
                className="main-next-action"
                onClick={() => {
                  setCreateIsPublic(false);
                  setEntryMode("create");
                }}
              >
                我来创建
              </Button>
            </article>

            <div className="entry-cta-divider" aria-hidden="true">
              <span>或者</span>
            </div>

            <article className="panel entry-option-card entry-option-secondary acet-card-lift">
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
          </motion.section>
        )}

        {entryMode === "create" && (
          <CreateRoomForm
            initialNickname={nickname}
            initialIsPublic={createIsPublic}
            busy={busy}
            onCancel={() => setEntryMode(null)}
            onSubmit={handleCreateSubmit}
          />
        )}

        {entryMode === "join" && (
          <JoinRoomForm
            initialNickname={nickname}
            initialJoinCodeSlots={joinCodeSlots}
            busy={busy}
            onCancel={() => setEntryMode(null)}
            onSubmit={handleJoinSubmit}
          />
        )}

        <div className="notice-toast-stack">
          {error && <NoticeToast type="error" message={error} onClose={() => setError("")} />}
          {message && <NoticeToast type="success" message={message} onClose={() => setMessage("")} />}
        </div>

        {process.env.NODE_ENV === "development" && (
          <motion.section
            className="panel"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.42, delay: 0.3, ease: "easeOut" }}
            style={{ marginTop: 24, border: "1px dashed var(--primary, #4ade80)" }}
          >
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div className="text-sm tracking-[0.14em] uppercase text-[color:var(--primary)] font-bold">
                  Dev Tools
                </div>
                <div className="text-sm text-[color:var(--muted)] mt-1">白板猜词 AI 判定测试工具</div>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push("/dev/whiteboard-test")}
              >
                打开测试
              </Button>
            </div>
          </motion.section>
        )}
      </main>
    </div>
  );
}
