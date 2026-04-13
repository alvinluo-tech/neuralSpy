"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { NoticeToast } from "@/components/ui/notice-toast";
import { useRoomData } from "@/hooks/useRoomData";
import { AI_GENERATING_SUMMARY, useRoomLogic } from "@/hooks/useRoomLogic";
import { useCategorySearch } from "@/hooks/useCategorySearch";
import {
  isWhiteboardRole,
  sanitizeRoomSummary,
  WHITEBOARD_GUESS_PENDING_MARKER,
} from "@/lib/gameEngine";
import { trackEvent } from "@/lib/umami";
import { supabase } from "@/lib/supabase";

const SESSION_KEY = "undercover.session.id";
const WHITEBOARD_COUNT_STORAGE_PREFIX = "undercover.room.whiteboard.count.";
const randomSessionId = () => {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const resolveWinnerRole = (players: Array<{ is_alive: boolean; is_undercover: boolean; current_word: string | null }>) => {
  const aliveUndercover = players.filter((player) => player.is_alive && player.is_undercover).length;
  const aliveWhiteboard = players.filter((player) => player.is_alive && isWhiteboardRole(player)).length;
  const aliveCivilian = players.filter(
    (player) => player.is_alive && !player.is_undercover && player.current_word !== null,
  ).length;

  if (aliveUndercover + aliveWhiteboard === 0) return "civilian";
  if (aliveUndercover + aliveWhiteboard >= aliveCivilian) return "undercover";
  return "unknown";
};

const normalizeWhiteboardCount = (value: number) => {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(Math.trunc(value), 0), 2);
};

type RoomGameProps = {
  roomId: string;
  pageType: "lobby" | "play" | "result";
};

type GroqModelProfile = {
  priority: "P0" | "P1" | "P2" | "P3" | "P4";
  value: string;
  label: string;
  reason: string;
  scenario: string;
};

const GROQ_MODEL_PROFILES: GroqModelProfile[] = [
  {
    priority: "P0",
    value: "qwen/qwen3-32b",
    label: "qwen/qwen3-32b",
    reason: "中文理解能力强，语义细腻。",
    scenario: "默认生成引擎",
  },
  {
    priority: "P1",
    value: "moonshotai/kimi-k2-instruct",
    label: "moonshotai/kimi-k2-instruct",
    reason: "擅长中文细微差别与语感。",
    scenario: "高难度模式 / 文学分类",
  },
  {
    priority: "P2",
    value: "meta-llama/llama-4-scout-17b-16e-instruct",
    label: "meta-llama/llama-4-scout-17b-16e-instruct",
    reason: "兼顾速度与逻辑质量。",
    scenario: "通用词组生成",
  },
  {
    priority: "P3",
    value: "llama-3.3-70b-versatile",
    label: "llama-3.3-70b-versatile",
    reason: "复杂主题与推理能力强。",
    scenario: "复杂主题 / 逻辑校验",
  },
  {
    priority: "P4",
    value: "llama-3.1-8b-instant",
    label: "llama-3.1-8b-instant",
    reason: "响应速度快，适合轻量场景。",
    scenario: "简单 / 新手模式",
  },
];

const DEFAULT_GROQ_MODEL = GROQ_MODEL_PROFILES[0].value;
const AUTO_MODEL_VALUE = "__AUTO_RECOMMENDED_MODEL__";

export function RoomGame({ roomId, pageType }: RoomGameProps) {
  const router = useRouter();

  const [sessionId, setSessionId] = useState("");
  const [wordVisible, setWordVisible] = useState(false);
  const [voteTargetId, setVoteTargetId] = useState<string>("");
  const [roomCategoryDraftValue, setRoomCategoryDraftValue] = useState<string | null>(null);
  const [voteDurationDraftInputValue, setVoteDurationDraftInputValue] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(0);
  const [roomCategorySearchOpen, setRoomCategorySearchOpen] = useState(false);
  const [selectedAiModel, setSelectedAiModel] = useState(AUTO_MODEL_VALUE);
  const [showSyncToast, setShowSyncToast] = useState(false);
  const [whiteboardCountDraft, setWhiteboardCountDraft] = useState(() => {
    if (typeof window === "undefined") return 1;
    const raw = localStorage.getItem(`${WHITEBOARD_COUNT_STORAGE_PREFIX}${roomId}`);
    if (!raw) return 1;
    return normalizeWhiteboardCount(Number(raw));
  });
  const [whiteboardGuess, setWhiteboardGuess] = useState("");

  const { room, players, votes, loading: roomLoading, syncing: roomSyncing, error: roomError, loadRoomData } =
    useRoomData(roomId);
  const { categories, buildCategorySuggestions, refreshCategoryUsage } = useCategorySearch();
  const roomLogic = useRoomLogic(sessionId, room, players, {
    refreshRoom: () => loadRoomData(roomId, false),
  });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (raw) {
        setSessionId(raw);
        return;
      }
      const newId = randomSessionId();
      sessionStorage.setItem(SESSION_KEY, newId);
      setSessionId(newId);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const updateNow = () => setNowMs(Date.now());
    const initialTimer = window.setTimeout(updateNow, 0);
    const timer = window.setInterval(updateNow, 1000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!room?.status || !sessionId) return;
    trackEvent("room_status_change", {
      roomId,
      fromPageType: pageType,
      status: room.status,
      category: room.category,
    });
  }, [roomId, room?.status, room?.category, pageType, sessionId]);

  useEffect(() => {
    if (!room?.id) return;
    void refreshCategoryUsage();
  }, [room?.id, room?.round_number, refreshCategoryUsage]);

  useEffect(() => {
    if (!room) return;

    const expectedPageType: RoomGameProps["pageType"] =
      room.status === "lobby" ? "lobby" : room.status === "finished" ? "result" : "play";

    if (expectedPageType === pageType) return;
    router.replace(`/room/${roomId}/${expectedPageType}`);
  }, [room, pageType, roomId, router]);

  const forcedExitTimerRef = useRef<number | null>(null);
  const currentPlayer = players.find((player) => player.session_id === sessionId) ?? null;
  const isHost = room?.host_session_id === sessionId;
  const alivePlayers = players.filter((player) => player.is_alive);
  const voteCandidateIds = room?.vote_candidate_ids ?? [];
  const voteScopePlayers =
    voteCandidateIds.length === 0
      ? alivePlayers
      : alivePlayers.filter((player) => voteCandidateIds.includes(player.id));
  const eligibleVoters =
    voteCandidateIds.length === 0
      ? alivePlayers
      : alivePlayers.filter((player) => !voteCandidateIds.includes(player.id));
  const voteDeadlineMs = !room?.vote_deadline_at ? null : Date.parse(room.vote_deadline_at);
  const normalizedVoteDeadlineMs =
    voteDeadlineMs == null || Number.isNaN(voteDeadlineMs) ? null : voteDeadlineMs;
  const remainingVoteSeconds =
    normalizedVoteDeadlineMs == null ? null : Math.max(0, Math.ceil((normalizedVoteDeadlineMs - nowMs) / 1000));
  const votedCount = new Set(
    votes
      .filter((vote) => eligibleVoters.some((player) => player.id === vote.voter_player_id))
      .map((vote) => vote.voter_player_id)
  ).size;
  const canCurrentPlayerVote = !!currentPlayer?.is_alive && eligibleVoters.some((player) => player.id === currentPlayer.id);
  const tieCandidatePlayers =
    voteCandidateIds.length === 0
      ? []
      : alivePlayers.filter((player) => voteCandidateIds.includes(player.id));
  const rotatedPlayers =
    players.length <= 1
      ? players
      : (() => {
          const sorted = [...players].sort((a, b) => a.seat_no - b.seat_no);
          const rotation = room ? Math.max(room.round_number - 1, 0) % sorted.length : 0;
          return [...sorted.slice(rotation), ...sorted.slice(0, rotation)];
        })();
  const currentRoomCategory = room?.category ?? "";
  const currentVoteDuration = room?.vote_duration_seconds ?? 60;
  const whiteboardDisabledByThreePlayerMode = players.length === 3;
  const effectiveWhiteboardCount = whiteboardDisabledByThreePlayerMode ? 0 : whiteboardCountDraft;
  const isCurrentPlayerWhiteboard =
    !!currentPlayer && room?.status !== "lobby" && isWhiteboardRole(currentPlayer);
  const whiteboardGuessPendingForCurrentPlayer =
    !!currentPlayer &&
    isCurrentPlayerWhiteboard &&
    !currentPlayer.is_alive &&
    currentPlayer.id === room?.last_eliminated_player_id &&
    (room?.result_summary ?? "").includes(WHITEBOARD_GUESS_PENDING_MARKER);
  const displayRoomSummary = sanitizeRoomSummary(room?.result_summary);
  const roomCategoryInputValue = roomCategoryDraftValue ?? currentRoomCategory;
  const trimmedCategoryDraft = roomCategoryInputValue.trim();
  const categoryDirty = trimmedCategoryDraft !== currentRoomCategory.trim();
  const voteDurationInputValue = voteDurationDraftInputValue ?? String(currentVoteDuration);
  const parsedVoteDuration = Number(voteDurationInputValue);
  const voteDurationDraft =
    voteDurationInputValue.trim().length > 0 && Number.isFinite(parsedVoteDuration) && parsedVoteDuration >= 0
      ? Math.max(0, Math.trunc(parsedVoteDuration))
      : null;
  const voteDurationDirty =
    voteDurationDraftInputValue !== null &&
    (voteDurationDraft == null || voteDurationDraft !== currentVoteDuration);
  const roomCategorySuggestions = buildCategorySuggestions(roomCategoryInputValue);
  const aiModelOptions = GROQ_MODEL_PROFILES;
  const effectiveModel = selectedAiModel === AUTO_MODEL_VALUE ? DEFAULT_GROQ_MODEL : selectedAiModel || DEFAULT_GROQ_MODEL;
  const selectedModelProfile = GROQ_MODEL_PROFILES.find((item) => item.value === effectiveModel) ?? GROQ_MODEL_PROFILES[0];
  const forcedExitNotice =
    room && sessionId && players.length > 0 && !players.some((player) => player.session_id === sessionId)
      ? "你已被房主移出房间，正在返回大厅。"
      : "";

  useEffect(() => {
    if (!forcedExitNotice || !roomId || !sessionId || forcedExitTimerRef.current != null) return;
    void supabase.from("players").delete().eq("room_id", roomId).eq("session_id", sessionId);
    forcedExitTimerRef.current = window.setTimeout(() => {
      router.replace("/");
    }, 1200);
  }, [forcedExitNotice, roomId, sessionId, router]);

  useEffect(() => {
    return () => {
      if (forcedExitTimerRef.current != null) {
        window.clearTimeout(forcedExitTimerRef.current);
      }
    };
  }, []);

  const autoPublishingRef = useRef(false);
  const gameResultTrackedKeyRef = useRef<string | null>(null);
  const syncToastShownAtRef = useRef<number | null>(null);
  const syncToastDelayTimerRef = useRef<number | null>(null);
  const syncToastHideTimerRef = useRef<number | null>(null);
  const isGeneratingOverlayVisible =
    roomLogic.generatingWords || room?.result_summary === AI_GENERATING_SUMMARY;

  useEffect(() => {
    if (!room || pageType !== "result" || room.status !== "finished" || !isHost) return;

    const spyCount = players.filter((player) => player.is_undercover).length;
    const winnerRole = resolveWinnerRole(players);
    const trackingKey = `game_result_detail:${room.id}:${room.round_number}:${winnerRole}:${spyCount}`;

    if (gameResultTrackedKeyRef.current === trackingKey) return;

    if (typeof window !== "undefined") {
      if (sessionStorage.getItem(trackingKey)) {
        gameResultTrackedKeyRef.current = trackingKey;
        return;
      }
      sessionStorage.setItem(trackingKey, "1");
    }

    gameResultTrackedKeyRef.current = trackingKey;
    trackEvent("game_result_detail", {
      roomId: room.id,
      winnerRole,
      totalRounds: room.round_number,
      spyCount,
      voteEnabled: room.vote_enabled,
      voteDurationSeconds: room.vote_duration_seconds ?? 60,
    });
  }, [room, pageType, isHost, players]);

  useEffect(() => {
    const SHOW_DELAY_MS = 450;
    const MIN_VISIBLE_MS = 900;

    if (roomSyncing) {
      if (syncToastHideTimerRef.current != null) {
        window.clearTimeout(syncToastHideTimerRef.current);
        syncToastHideTimerRef.current = null;
      }

      if (!showSyncToast && syncToastDelayTimerRef.current == null) {
        syncToastDelayTimerRef.current = window.setTimeout(() => {
          syncToastShownAtRef.current = Date.now();
          setShowSyncToast(true);
          syncToastDelayTimerRef.current = null;
        }, SHOW_DELAY_MS);
      }
      return;
    }

    if (syncToastDelayTimerRef.current != null) {
      window.clearTimeout(syncToastDelayTimerRef.current);
      syncToastDelayTimerRef.current = null;
    }

    if (!showSyncToast) return;

    const shownAt = syncToastShownAtRef.current ?? Date.now();
    const elapsed = Date.now() - shownAt;
    const remain = Math.max(0, MIN_VISIBLE_MS - elapsed);

    syncToastHideTimerRef.current = window.setTimeout(() => {
      setShowSyncToast(false);
      syncToastShownAtRef.current = null;
      syncToastHideTimerRef.current = null;
    }, remain);

    return () => {
      if (syncToastHideTimerRef.current != null) {
        window.clearTimeout(syncToastHideTimerRef.current);
        syncToastHideTimerRef.current = null;
      }
    };
  }, [roomSyncing, showSyncToast]);

  useEffect(() => {
    return () => {
      if (syncToastDelayTimerRef.current != null) {
        window.clearTimeout(syncToastDelayTimerRef.current);
      }
      if (syncToastHideTimerRef.current != null) {
        window.clearTimeout(syncToastHideTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!room || room.status !== "voting" || autoPublishingRef.current) return;

    const voterCount = eligibleVoters.length;
    const allVoted = voterCount > 0 && votedCount >= voterCount;
    const deadlineReached = !!voteDeadlineMs && nowMs >= voteDeadlineMs;

    if (!allVoted && !deadlineReached) return;

    autoPublishingRef.current = true;
    void roomLogic.publishVotingResult(roomId).finally(() => {
      autoPublishingRef.current = false;
    });
  }, [room, eligibleVoters.length, votedCount, voteDeadlineMs, nowMs, roomLogic, roomId]);

  if (!sessionId || roomLoading) {
    return (
      <div className="page-shell">
        <main className="app-wrap">
          <section className="hero-card">
            <h1 className="hero-title">加载房间中...</h1>
          </section>
        </main>
      </div>
    );
  }

  if (roomError || !room) {
    return (
      <div className="page-shell">
        <main className="app-wrap">
          <section className="hero-card">
            <h1 className="hero-title" style={{ color: "red" }}>错误</h1>
            <p>{roomError || "房间不存在"}</p>
            <button className="btn primary" onClick={() => router.push("/")}>
              返回首页
            </button>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <main className="app-wrap">
        <section className="hero-card">
          <p className="eyebrow">游戏房间 {room.code}</p>
          <h1 className="hero-title">谁是卧底多人房间</h1>
          <p className="hero-subtitle">
            状态：
            {room.status === "lobby" ? "大厅" : room.status === "playing" ? "游戏进行中" : room.status === "voting" ? "投票进行中" : "游戏结束"}
          </p>
        </section>

        <section className="panel-grid room-grid">
          <article className="panel">
            <h2>房间信息</h2>
            <div className="status-row">
              <span className="status-pill">邀请码：{room.code}</span>
              <span className="status-pill">
                状态：
                {room.status === "lobby" ? "大厅" : room.status === "playing" ? "游戏中" : room.status === "voting" ? "投票中" : "结束"}
              </span>
              <span className="status-pill">类别：{room.category}</span>
            </div>
            <p className="hint">局数：{room.round_number} · 投票轮次：{room.vote_round}</p>
            <p className="hint">投票功能：{room.vote_enabled ? "开启" : "关闭"}</p>
            <p className="hint">每轮限时：{room.vote_duration_seconds ?? 60} 秒</p>

            {isHost && (
              <div
                className="room-category-editor"
                style={{ position: "relative" }}
                onBlur={() => {
                  window.setTimeout(() => setRoomCategorySearchOpen(false), 120);
                }}
              >
                <div className="inline-row">
                  <input
                    type="text"
                    value={roomCategoryInputValue}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      setRoomCategoryDraftValue(nextValue);
                    }}
                    onFocus={() => setRoomCategorySearchOpen(true)}
                    placeholder="搜索并修改房间类别"
                  />
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={async () => {
                      if (!trimmedCategoryDraft) {
                        roomLogic.setError("类别不能为空。");
                        return;
                      }
                      const ok = await roomLogic.updateRoomCategory(roomId, trimmedCategoryDraft);
                      if (ok) {
                        setRoomCategoryDraftValue(null);
                        setRoomCategorySearchOpen(false);
                      }
                    }}
                    disabled={roomLogic.busy || !categoryDirty || !trimmedCategoryDraft}
                  >
                    保存类别
                  </button>
                </div>

                {roomCategorySearchOpen && (
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
                      maxHeight: "260px",
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
                      {roomCategoryInputValue.trim() ? "模糊匹配结果" : "Top10 热门种类词"}
                    </div>

                    {roomCategorySuggestions.map((item) => (
                      <button
                        key={`room-${item.key}`}
                        type="button"
                        style={{
                          width: "100%",
                          textAlign: "left",
                          padding: "8px 12px",
                          border: "none",
                          borderBottom: "1px solid #eee",
                          backgroundColor: trimmedCategoryDraft === item.subcategoryDisplayName ? "#e8f4f8" : "#fff",
                          cursor: "pointer",
                        }}
                        onClick={() => {
                          const nextCategory = item.subcategoryDisplayName;
                          setRoomCategoryDraftValue(nextCategory);
                          setRoomCategorySearchOpen(false);
                        }}
                      >
                        <div style={{ fontWeight: 600 }}>{item.subcategoryDisplayName}</div>
                        <div style={{ fontSize: "12px", color: "#666" }}>
                          {item.categoryDisplayName}
                          {item.examples.length > 0 ? ` · 例：${item.examples.join(" vs ")}` : ""}
                          {item.usageCount > 0 ? ` · 热度 ${item.usageCount}` : ""}
                        </div>
                      </button>
                    ))}

                    {roomCategoryInputValue.trim() && (
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
                          const custom = roomCategoryInputValue.trim();
                          setRoomCategoryDraftValue(custom);
                          setRoomCategorySearchOpen(false);
                        }}
                      >
                        使用“{roomCategoryInputValue.trim()}”作为自定义类别
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {isHost && (
              <div className="inline-row room-category-editor">
                <label style={{ flex: 1 }}>
                  白板人数（0-2）
                  <input
                    type="number"
                    min={0}
                    max={2}
                    value={effectiveWhiteboardCount}
                    disabled={roomLogic.busy || room.status === "voting" || whiteboardDisabledByThreePlayerMode}
                    onChange={(event) => {
                      const nextValue = normalizeWhiteboardCount(Number(event.target.value));
                      setWhiteboardCountDraft(nextValue);
                      localStorage.setItem(`${WHITEBOARD_COUNT_STORAGE_PREFIX}${roomId}`, String(nextValue));
                    }}
                  />
                </label>
              </div>
            )}

            {whiteboardDisabledByThreePlayerMode && (
              <p className="hint">3 人局暂不支持白板，已自动禁用。</p>
            )}

            {isHost && (
              <div className="inline-row room-category-editor">
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={voteDurationInputValue}
                  onChange={(event) => {
                    const nextValue = event.target.value.replace(/[^\d]/g, "");
                    setVoteDurationDraftInputValue(nextValue);
                  }}
                  placeholder="投票时长（秒）"
                />
                <button
                  type="button"
                  className="btn ghost"
                  onClick={async () => {
                    if (voteDurationDraft == null) {
                      roomLogic.setError("请输入大于等于 0 秒的投票时长。");
                      return;
                    }
                    const ok = await roomLogic.updateVoteDuration(roomId, voteDurationDraft);
                    if (ok) {
                      setVoteDurationDraftInputValue(null);
                    }
                  }}
                  disabled={roomLogic.busy || !voteDurationDirty || voteDurationDraft == null}
                >
                  保存投票时长
                </button>
              </div>
            )}

            {currentPlayer && (
              <div className="word-card self-word-card">
                <span className="tag">你的身份词</span>
                {room.status === "lobby" ? (
                  <strong>等待房主开局</strong>
                ) : isCurrentPlayerWhiteboard && wordVisible ? (
                  <>
                    <div className="whiteboard-ink-card" aria-hidden="true" />
                    <strong>你是白板</strong>
                    <p className="whiteboard-breathing-hint">你没有词，请根据他人描述盲猜。</p>
                  </>
                ) : wordVisible ? (
                  <strong>{currentPlayer.current_word ?? "暂未发词"}</strong>
                ) : (
                  <strong>点击按钮查看你的词</strong>
                )}
              </div>
            )}

            <div className="actions-row">
              {room.status !== "lobby" && (
                <button type="button" className="btn" onClick={() => setWordVisible((v) => !v)}>
                  {wordVisible ? "隐藏我的词" : "显示我的词"}
                </button>
              )}
              <button
                type="button"
                className="btn ghost"
                onClick={async () => {
                  const success = await roomLogic.leaveRoom(roomId);
                  if (success) {
                    router.replace("/");
                  }
                }}
              >
                退出房间
              </button>
            </div>

            {isHost && (
              <div className="host-actions">
                <h3>房主操作</h3>
                <div className="inline-row room-category-editor">
                  <label style={{ flex: 1 }}>
                    AI 模型策略
                    <select
                      value={selectedAiModel}
                      onChange={(event) => setSelectedAiModel(event.target.value)}
                      disabled={roomLogic.busy || room.status === "voting"}
                    >
                      <option value={AUTO_MODEL_VALUE}>智能推荐（默认）· P0 · {DEFAULT_GROQ_MODEL}</option>
                      {aiModelOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {`${option.priority} · ${option.label}（手动指定）`}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <p className="hint">
                  当前实际调用模型：{selectedModelProfile.label}（{selectedModelProfile.priority}） · {selectedModelProfile.reason}
                </p>
                <p className="hint">适用场景：{selectedModelProfile.scenario}</p>
                <div className="actions-row">
                  <button
                    type="button"
                    className="btn primary"
                    onClick={() =>
                      roomLogic.startRound(roomId, room.category, room.undercover_count, effectiveWhiteboardCount, categories, {
                        provider: "groq",
                        model: effectiveModel,
                      })
                    }
                    disabled={roomLogic.busy || room.status === "voting"}
                  >
                    {room.round_number === 0 ? "开始本局（AI 生成 1 组词）" : "重开新局（重新生成 1 组词）"}
                  </button>
                  {room.vote_enabled && room.status === "playing" && (
                    <button type="button" className="btn" onClick={() => roomLogic.openVoting(roomId)} disabled={roomLogic.busy}>
                      {room.vote_candidate_ids && room.vote_candidate_ids.length > 0
                        ? `开启第 ${room.vote_round} 轮加赛投票`
                        : `开启第 ${room.vote_round} 轮投票`}
                    </button>
                  )}
                  {room.vote_enabled && room.status === "voting" && (
                    <button
                      type="button"
                      className="btn primary"
                      onClick={() => roomLogic.publishVotingResult(roomId)}
                      disabled={roomLogic.busy}
                    >
                      公布本轮投票结果
                    </button>
                  )}
                </div>
              </div>
            )}
          </article>

          <article className="panel">
            <h2>玩家列表</h2>
            <p className="hint">当前发言顺序（每局自动轮换）：</p>
            <ul className="player-list">
              {rotatedPlayers.map((player, index) => (
                <li key={player.id} className={!player.is_alive ? "out" : ""}>
                  <span className="player-main">
                    第{index + 1}位 ·#{player.seat_no} {player.name} {player.session_id === sessionId ? "(你)" : ""}
                  </span>
                  <span className="player-side">
                    <strong>{player.is_alive ? "存活" : "出局"}</strong>
                    {isHost && player.session_id !== sessionId && (
                      <button
                        type="button"
                        className="btn danger tiny"
                        onClick={() => roomLogic.kickPlayer(roomId, player)}
                        disabled={roomLogic.busy}
                      >
                        踢出
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>

            {room.vote_enabled && room.status === "voting" && currentPlayer && (
              <div className="vote-box">
                <h3>本轮投票</h3>
                <p className="hint">
                  已投票人数：{votedCount}/{eligibleVoters.length}
                  {remainingVoteSeconds != null ? ` · 剩余 ${remainingVoteSeconds} 秒` : ""}
                </p>

                {!currentPlayer.is_alive && <p className="hint">你已出局，当前只能查看投票进度。</p>}

                {room.vote_candidate_ids && room.vote_candidate_ids.length > 0 && (
                  <p className="hint">
                    当前为平票加赛：候选人仅限
                    {tieCandidatePlayers.length > 0
                      ? ` ${tieCandidatePlayers.map((p) => `#${p.seat_no} ${p.name}`).join("、")}`
                      : " 平票玩家"}
                    ；仅其余存活玩家可投票。
                  </p>
                )}

                {!canCurrentPlayerVote && room.vote_candidate_ids && room.vote_candidate_ids.length > 0 && (
                  <p className="hint">你是平票候选人，本轮不能投票，请等待其他存活玩家投票。</p>
                )}

                {!canCurrentPlayerVote && !room.vote_candidate_ids && currentPlayer.is_alive && (
                  <p className="hint">你当前轮次不可投票，请等待房主开启下一轮或结算。</p>
                )}

                <label>
                  选择你怀疑的卧底
                  <select value={voteTargetId} onChange={(event) => setVoteTargetId(event.target.value)} disabled={!canCurrentPlayerVote}>
                    <option value="">请选择玩家</option>
                    <option value="__ABSTAIN__">弃票（不投任何人）</option>
                    {voteScopePlayers
                      .filter((p) => p.id !== currentPlayer.id)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          玩家 {p.seat_no} · {p.name}
                        </option>
                      ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => roomLogic.castVote(roomId, voteTargetId, voteScopePlayers)}
                  disabled={roomLogic.busy || !canCurrentPlayerVote}
                >
                  提交/更新我的投票
                </button>
              </div>
            )}

            {displayRoomSummary && <p className="hint room-summary">{displayRoomSummary}</p>}
          </article>
        </section>

        {whiteboardGuessPendingForCurrentPlayer && (
          <div className="whiteboard-drawer" role="dialog" aria-modal="true" aria-label="白板临终猜词">
            <div className="whiteboard-drawer-card">
              <h3>白板临终猜词</h3>
              <p className="hint">你已出局。猜中平民词即可触发白板单独获胜。</p>
              <input
                type="text"
                value={whiteboardGuess}
                onChange={(event) => setWhiteboardGuess(event.target.value)}
                placeholder="请输入你猜测的平民词"
              />
              <div className="actions-row">
                <button
                  type="button"
                  className="btn primary"
                  disabled={roomLogic.busy || !whiteboardGuess.trim()}
                  onClick={() => roomLogic.submitWhiteboardGuess(roomId, whiteboardGuess, "grok")}
                >
                  提交猜词
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="notice-toast-stack">
          {forcedExitNotice && (
            <NoticeToast type="error" message={forcedExitNotice} onClose={() => {}} />
          )}
          {showSyncToast && (
            <NoticeToast
              type="info"
              message="同步中..."
              onClose={() => {}}
              autoDismiss={false}
              showClose={false}
            />
          )}
          {!forcedExitNotice && roomLogic.error && (
            <NoticeToast type="error" message={roomLogic.error} onClose={() => roomLogic.setError("")} />
          )}
          {roomLogic.message && (
            <NoticeToast type="success" message={roomLogic.message} onClose={() => roomLogic.setMessage("")} />
          )}
        </div>

        {isGeneratingOverlayVisible && (
          <div className="global-overlay" role="status" aria-live="polite" aria-label="AI生成中">
            <div className="global-overlay-card">
              <p className="overlay-title">AI 正在生成本局词条</p>
              <p className="overlay-subtitle">请稍候，生成完成后会自动进入游戏。</p>
            </div>
          </div>
        )}

        <AlertDialog
          open={roomLogic.confirmDialog.open}
          onOpenChange={(open) => {
            if (!open) roomLogic.resolveConfirmation(false);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{roomLogic.confirmDialog.title}</AlertDialogTitle>
              <AlertDialogDescription>{roomLogic.confirmDialog.description}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel asChild>
                <Button type="button" variant="outline" onClick={() => roomLogic.resolveConfirmation(false)}>
                  {roomLogic.confirmDialog.cancelText}
                </Button>
              </AlertDialogCancel>
              <AlertDialogAction asChild>
                <Button
                  type="button"
                  variant={roomLogic.confirmDialog.tone === "danger" ? "danger" : "default"}
                  onClick={() => roomLogic.resolveConfirmation(true)}
                >
                  {roomLogic.confirmDialog.confirmText}
                </Button>
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </main>
    </div>
  );
}
