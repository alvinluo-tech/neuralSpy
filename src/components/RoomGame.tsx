"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
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
import { ABSTAIN_VOTE_VALUE, AI_GENERATING_SUMMARY, useRoomLogic } from "@/hooks/useRoomLogic";
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

const safeGetLocalValue = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const safeSetLocalValue = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {}
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

type SaveState = "idle" | "saving" | "saved";

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

const LOBBY_STEPS = ["设置规则", "等待玩家", "开始游戏"] as const;

const resolveLobbyStep = (playerCount: number) => {
  if (playerCount >= 3) return 3;
  if (playerCount >= 2) return 2;
  return 1;
};

function LobbySteps({ currentStep }: { currentStep: number }) {
  return (
    <div className="lobby-steps" aria-label="大厅流程步骤">
      {LOBBY_STEPS.map((label, index) => {
        const step = index + 1;
        const state = currentStep > step ? "done" : currentStep === step ? "current" : "todo";

        return (
          <div key={label} className="lobby-step-block">
            <div className={`lobby-step-dot ${state}`}>{currentStep > step ? "OK" : step}</div>
            <span className={`lobby-step-label ${state}`}>{label}</span>
            {index < LOBBY_STEPS.length - 1 && <span className="lobby-step-line" aria-hidden="true" />}
          </div>
        );
      })}
    </div>
  );
}

function GameProgressCard({
  currentRound,
  remainingPlayers,
  totalPlayers,
}: {
  currentRound: number;
  remainingPlayers: number;
  totalPlayers: number;
}) {
  const totalRounds = Math.max(5, currentRound);
  const progress = Math.min(100, (currentRound / totalRounds) * 100);

  return (
    <div className="game-progress-card">
      <div className="game-progress-head">
        <div>
          <p className="hint">当前轮次</p>
          <p className="game-progress-value">第 {currentRound} 轮</p>
        </div>
        <div className="game-progress-right">
          <p className="hint">存活玩家</p>
          <p className="game-progress-value">
            {remainingPlayers}/{totalPlayers}
          </p>
        </div>
      </div>
      <div className="game-progress-track" aria-hidden="true">
        <div className="game-progress-fill" style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}

function VoteCountdownRing({ remainingSeconds, totalSeconds }: { remainingSeconds: number; totalSeconds: number }) {
  const safeTotal = Math.max(1, totalSeconds);
  const clampedRemaining = Math.max(0, Math.min(remainingSeconds, safeTotal));
  const percentage = (clampedRemaining / safeTotal) * 100;
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  const isUrgent = clampedRemaining <= 10;

  return (
    <div className="vote-countdown" role="timer" aria-live="polite" aria-label={`剩余 ${clampedRemaining} 秒`}>
      <svg viewBox="0 0 100 100" className="vote-countdown-svg" aria-hidden="true">
        <circle cx="50" cy="50" r={radius} className="vote-countdown-bg" />
        <circle
          cx="50"
          cy="50"
          r={radius}
          className={`vote-countdown-fg${isUrgent ? " urgent" : ""}`}
          style={{
            strokeDasharray: circumference,
            strokeDashoffset: circumference * (1 - percentage / 100),
          }}
        />
      </svg>
      <div className="vote-countdown-text">
        <strong>{clampedRemaining}</strong>
        <span>秒</span>
      </div>
    </div>
  );
}

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
  const [showHostControlPanel, setShowHostControlPanel] = useState(true);
  const [showHostSettingsPanel, setShowHostSettingsPanel] = useState(false);
  const [voteSubmitToast, setVoteSubmitToast] = useState("");
  const [presenceJoinToast, setPresenceJoinToast] = useState("");
  const [presenceLeaveToast, setPresenceLeaveToast] = useState("");
  const [categorySaveState, setCategorySaveState] = useState<SaveState>("idle");
  const [undercoverSaveState, setUndercoverSaveState] = useState<SaveState>("idle");
  const [voteDurationSaveState, setVoteDurationSaveState] = useState<SaveState>("idle");
  const [undercoverCountDraftInputValue, setUndercoverCountDraftInputValue] = useState<string | null>(null);
  const [whiteboardCountDraft, setWhiteboardCountDraft] = useState(() => {
    if (typeof window === "undefined") return 1;
    const raw = safeGetLocalValue(`${WHITEBOARD_COUNT_STORAGE_PREFIX}${roomId}`);
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
      const raw = safeGetSessionValue(SESSION_KEY);
      if (raw) {
        setSessionId(raw);
        return;
      }
      const newId = randomSessionId();
      safeSetSessionValue(SESSION_KEY, newId);
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
  const playerSnapshotReadyRef = useRef(false);
  const prevPlayersRef = useRef<Map<string, { seat_no: number; name: string; session_id: string }>>(new Map());
  const suppressedLeavePlayerIdsRef = useRef<Set<string>>(new Set());
  const currentPlayer = players.find((player) => player.session_id === sessionId) ?? null;
  const isHost = room?.host_session_id === sessionId;
  const canEditRoomConfig = isHost;
  const alivePlayers = players.filter((player) => player.is_alive);
  const voteCandidateIds = room?.vote_candidate_ids ?? [];
  const restrictedTieBreak = voteCandidateIds.length > 0 && voteCandidateIds.length < alivePlayers.length;
  const voteScopePlayers =
    voteCandidateIds.length === 0
      ? alivePlayers
      : alivePlayers.filter((player) => voteCandidateIds.includes(player.id));
  const eligibleVoters =
    voteCandidateIds.length === 0 || !restrictedTieBreak
      ? alivePlayers
      : alivePlayers.filter((player) => !voteCandidateIds.includes(player.id));
  const voteDeadlineMs = !room?.vote_deadline_at ? null : Date.parse(room.vote_deadline_at);
  const normalizedVoteDeadlineMs =
    voteDeadlineMs == null || Number.isNaN(voteDeadlineMs) ? null : voteDeadlineMs;
  const remainingVoteSeconds =
    normalizedVoteDeadlineMs == null ? null : Math.max(0, Math.ceil((normalizedVoteDeadlineMs - nowMs) / 1000));
  const currentRoundVotes = votes.filter(
    (vote) => vote.round_number === room?.round_number && vote.vote_round === room?.vote_round,
  );
  const votedCount = new Set(
    currentRoundVotes
      .filter((vote) => eligibleVoters.some((player) => player.id === vote.voter_player_id))
      .map((vote) => vote.voter_player_id)
  ).size;
  const votedPlayerIds = new Set(currentRoundVotes.map((vote) => vote.voter_player_id));
  const canCurrentPlayerVote = !!currentPlayer?.is_alive && eligibleVoters.some((player) => player.id === currentPlayer.id);
  const voteCandidateOptions = [
    ...voteScopePlayers
      .filter((player) => player.id !== currentPlayer?.id)
      .map((player) => ({
        key: player.id,
        value: player.id,
        title: `玩家 ${player.seat_no}`,
        meta: player.name,
        isAbstain: false,
      })),
    {
      key: ABSTAIN_VOTE_VALUE,
      value: ABSTAIN_VOTE_VALUE,
      title: "弃票",
      meta: "本轮不投任何人",
      isAbstain: true,
    },
  ];
  const hasVoteSelection = voteTargetId.trim().length > 0;
  const canSubmitVote = canCurrentPlayerVote && hasVoteSelection;
  const voteInlineStatus = roomSyncing
    ? "同步中，正在更新投票状态..."
    : !currentPlayer?.is_alive
      ? "你已出局，当前只能查看投票进度。"
      : !canCurrentPlayerVote && restrictedTieBreak && voteCandidateIds.length > 0
        ? "你是平票候选人，本轮不能投票，请等待其他存活玩家投票。"
        : !canCurrentPlayerVote
          ? "你当前轮次不可投票，请等待下一轮或结算。"
          : null;
  const voteWindowOpen = room?.status === "voting";
  const voteExpired =
    voteWindowOpen && normalizedVoteDeadlineMs != null ? nowMs >= normalizedVoteDeadlineMs : false;
  const allEligibleVoted = eligibleVoters.length > 0 && votedCount >= eligibleVoters.length;
  const voteSettlementReady = voteWindowOpen && (allEligibleVoted || voteExpired);
  const wordsGenerating = roomLogic.generatingWords || room?.result_summary === AI_GENERATING_SUMMARY;

  type HostControlPhase =
    | "lobby-ready"
    | "dealing-words"
    | "discussion"
    | "vote-collecting"
    | "vote-ready"
    | "finished";

  type HostControlStep = "setup" | "discussion" | "voting" | "settle";

  const hostControlPhase: HostControlPhase =
    room?.status === "finished"
      ? "finished"
      : room?.status === "voting"
        ? voteSettlementReady
          ? "vote-ready"
          : "vote-collecting"
        : room?.status === "playing"
          ? wordsGenerating
            ? "dealing-words"
            : "discussion"
          : wordsGenerating
            ? "dealing-words"
            : "lobby-ready";

  const hostControlPhaseMeta: Record<
    HostControlPhase,
    { label: string; hint: string; progress: number; step: HostControlStep; tone: HostControlStep | "finished" }
  > = {
    "lobby-ready": {
      label: "待开局",
      hint: "确认规则后开始本局。",
      progress: 16,
      step: "setup",
      tone: "setup",
    },
    "dealing-words": {
      label: "发词准备中",
      hint: "AI 正在生成并分发词条。",
      progress: 28,
      step: "setup",
      tone: "setup",
    },
    discussion: {
      label: "讨论发言中",
      hint: "组织发言，准备开启投票。",
      progress: 46,
      step: "discussion",
      tone: "discussion",
    },
    "vote-collecting": {
      label: "投票收集中",
      hint: `已投 ${votedCount}/${eligibleVoters.length}，可等待全员投完或倒计时结束。`,
      progress: 72,
      step: "voting",
      tone: "voting",
    },
    "vote-ready": {
      label: "待公布结果",
      hint: "已满足结算条件，可立即公布结果。",
      progress: 90,
      step: "settle",
      tone: "settle",
    },
    finished: {
      label: "对局已结束",
      hint: "可以直接重开新局。",
      progress: 100,
      step: "settle",
      tone: "finished",
    },
  };

  const hostControlStepLabels: Array<{ key: HostControlStep; label: string }> = [
    { key: "setup", label: "准备" },
    { key: "discussion", label: "讨论" },
    { key: "voting", label: "投票" },
    { key: "settle", label: "公布" },
  ];

  const hostControlStepIndex: Record<HostControlStep, number> = {
    setup: 0,
    discussion: 1,
    voting: 2,
    settle: 3,
  };
  const hostControlCurrentStepIndex = hostControlStepIndex[hostControlPhaseMeta[hostControlPhase].step];
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
  const currentUndercoverCount = room?.undercover_count ?? 1;
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
  const lobbyCurrentStep = resolveLobbyStep(players.length);
  const showGameProgress = room?.status === "playing" || room?.status === "voting";
  const roomCategoryInputValue = roomCategoryDraftValue ?? currentRoomCategory;
  const trimmedCategoryDraft = roomCategoryInputValue.trim();
  const categoryDirty = trimmedCategoryDraft !== currentRoomCategory.trim();
  const undercoverCountInputValue = undercoverCountDraftInputValue ?? String(currentUndercoverCount);
  const parsedUndercoverCount = Number(undercoverCountInputValue);
  const undercoverCountDraft =
    undercoverCountInputValue.trim().length > 0 &&
    Number.isFinite(parsedUndercoverCount) &&
    parsedUndercoverCount >= 1 &&
    parsedUndercoverCount <= 3
      ? Math.trunc(parsedUndercoverCount)
      : null;
  const undercoverCountDirty =
    undercoverCountDraftInputValue !== null &&
    (undercoverCountDraft == null || undercoverCountDraft !== currentUndercoverCount);
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
    playerSnapshotReadyRef.current = false;
    prevPlayersRef.current = new Map();
    suppressedLeavePlayerIdsRef.current.clear();
  }, [roomId]);

  useEffect(() => {
    if (roomLoading || !room) return;

    const currentMap = new Map(
      players.map((player) => [
        player.id,
        { seat_no: player.seat_no, name: player.name, session_id: player.session_id },
      ])
    );

    if (!playerSnapshotReadyRef.current) {
      prevPlayersRef.current = currentMap;
      playerSnapshotReadyRef.current = true;
      return;
    }

    const prevMap = prevPlayersRef.current;
    const joined = players
      .filter((player) => !prevMap.has(player.id) && player.session_id !== sessionId)
      .map((player) => `玩家${player.seat_no}（${player.name}）`);
    const leftEntries = Array.from(prevMap.entries()).filter(
      ([id, player]) => !currentMap.has(id) && player.session_id !== sessionId,
    );
    const left = leftEntries
      .filter(([id]) => !suppressedLeavePlayerIdsRef.current.has(id))
      .map(([, player]) => `玩家${player.seat_no}（${player.name}）`);

    for (const [id] of leftEntries) {
      suppressedLeavePlayerIdsRef.current.delete(id);
    }

    if (joined.length > 0) {
      const nextMessage = `${joined.join("、")}加入了房间`;
      window.setTimeout(() => {
        setPresenceJoinToast(nextMessage);
      }, 0);
    }

    if (left.length > 0) {
      const nextMessage = `${left.join("、")}离开了房间`;
      window.setTimeout(() => {
        setPresenceLeaveToast(nextMessage);
      }, 0);
    }

    prevPlayersRef.current = currentMap;
  }, [players, roomLoading, room, sessionId]);

  useEffect(() => {
    return () => {
      if (forcedExitTimerRef.current != null) {
        window.clearTimeout(forcedExitTimerRef.current);
      }
    };
  }, []);

  const autoPublishingRef = useRef(false);
  const autoSettleVoteKeyRef = useRef<string | null>(null);
  const categorySaveResetTimerRef = useRef<number | null>(null);
  const undercoverSaveResetTimerRef = useRef<number | null>(null);
  const voteDurationSaveResetTimerRef = useRef<number | null>(null);
  const gameResultTrackedKeyRef = useRef<string | null>(null);
  const isGeneratingOverlayVisible = wordsGenerating;

  useEffect(() => {
    if (!room || pageType !== "result" || room.status !== "finished" || !isHost) return;

    const spyCount = players.filter((player) => player.is_undercover).length;
    const winnerRole = resolveWinnerRole(players);
    const trackingKey = `game_result_detail:${room.id}:${room.round_number}:${winnerRole}:${spyCount}`;

    if (gameResultTrackedKeyRef.current === trackingKey) return;

    if (typeof window !== "undefined") {
      if (safeGetSessionValue(trackingKey)) {
        gameResultTrackedKeyRef.current = trackingKey;
        return;
      }
      safeSetSessionValue(trackingKey, "1");
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
    return () => {
      if (categorySaveResetTimerRef.current != null) {
        window.clearTimeout(categorySaveResetTimerRef.current);
      }
      if (undercoverSaveResetTimerRef.current != null) {
        window.clearTimeout(undercoverSaveResetTimerRef.current);
      }
      if (voteDurationSaveResetTimerRef.current != null) {
        window.clearTimeout(voteDurationSaveResetTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!room || room.status !== "voting" || autoPublishingRef.current) return;

    const voteKey = `${room.round_number}:${room.vote_round}`;
    if (autoSettleVoteKeyRef.current === voteKey) return;

    const voterCount = eligibleVoters.length;
    const allVoted = voterCount > 0 && votedCount >= voterCount;
    const deadlineReached = !!voteDeadlineMs && nowMs >= voteDeadlineMs;

    if (!allVoted && !deadlineReached) return;

    autoPublishingRef.current = true;
    void roomLogic
      .publishVotingResult(roomId, { silentNoop: true })
      .then((outcome) => {
        const shouldRetry =
          outcome.action === "noop" && outcome.reason === "waiting-for-deadline-or-all-votes";
        // Retry only when it is genuinely waiting; avoid hammering the API on terminal noops.
        autoSettleVoteKeyRef.current = shouldRetry ? null : voteKey;
      })
      .finally(() => {
        autoPublishingRef.current = false;
      });
  }, [room, eligibleVoters.length, votedCount, voteDeadlineMs, nowMs, roomLogic, roomId]);

  useEffect(() => {
    if (room?.status !== "voting") {
      autoSettleVoteKeyRef.current = null;
    }
  }, [room?.status, room?.round_number, room?.vote_round]);

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
            <h1 className="hero-title error-title">错误</h1>
            <p>{roomError || "房间不存在"}</p>
            <Button type="button" variant="primary" onClick={() => router.push("/")}>
              返回首页
            </Button>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <main className="app-wrap aceternity-stage">
        <section className="hero-card hero-card--lift acet-spotlight">
          <p className="eyebrow">游戏房间 {room.code}</p>
          <h1 className="hero-title">谁是卧底多人房间</h1>
          <p className="hero-subtitle">
            状态：
            {room.status === "lobby" ? "大厅" : room.status === "playing" ? "游戏进行中" : room.status === "voting" ? "投票进行中" : "游戏结束"}
          </p>
        </section>

        {room.status === "lobby" && (
          <section className="panel lobby-steps-panel">
            <LobbySteps currentStep={lobbyCurrentStep} />
            <p className="hint">
              当前 {players.length} 人在房间，至少 3 人才能开局。
            </p>
          </section>
        )}

        {showGameProgress && (
          <section className="panel game-progress-panel">
            <GameProgressCard
              currentRound={Math.max(room.round_number, 1)}
              remainingPlayers={alivePlayers.length}
              totalPlayers={players.length}
            />
          </section>
        )}

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

            {canEditRoomConfig && (
              <div className="host-panel-switch acet-pill-tabs" role="tablist" aria-label="房主操作分区">
                <Button
                  type="button"
                  variant={showHostControlPanel ? "primary" : "secondary"}
                  size="sm"
                  onClick={() => setShowHostControlPanel((value) => !value)}
                >
                  {showHostControlPanel ? "收起本局控制" : "展开本局控制"}
                </Button>
                <Button
                  type="button"
                  variant={showHostSettingsPanel ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setShowHostSettingsPanel((value) => !value)}
                >
                  {showHostSettingsPanel ? "收起房间设置" : "展开房间设置"}
                </Button>
              </div>
            )}

            {canEditRoomConfig && showHostSettingsPanel && (
              <div
                className="room-category-editor category-picker"
                onBlur={() => {
                  window.setTimeout(() => setRoomCategorySearchOpen(false), 120);
                }}
              >
                <div className="inline-row">
                  <input
                    type="text"
                    className="category-picker-input"
                    value={roomCategoryInputValue}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      setRoomCategoryDraftValue(nextValue);
                    }}
                    onFocus={() => setRoomCategorySearchOpen(true)}
                    placeholder="搜索并修改房间类别"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    className={`${categorySaveState === "saving" ? "loading" : ""}${categorySaveState === "saved" ? " saved" : ""}`.trim() || undefined}
                    onClick={async () => {
                      if (!trimmedCategoryDraft) {
                        roomLogic.setError("类别不能为空。");
                        return;
                      }

                      setCategorySaveState("saving");
                      const ok = await roomLogic.updateRoomCategory(roomId, trimmedCategoryDraft);
                      if (ok) {
                        setRoomCategoryDraftValue(null);
                        setRoomCategorySearchOpen(false);
                        setCategorySaveState("saved");
                        if (categorySaveResetTimerRef.current != null) {
                          window.clearTimeout(categorySaveResetTimerRef.current);
                        }
                        categorySaveResetTimerRef.current = window.setTimeout(() => {
                          setCategorySaveState("idle");
                          categorySaveResetTimerRef.current = null;
                        }, 1200);
                      } else {
                        setCategorySaveState("idle");
                      }
                    }}
                    disabled={roomLogic.busy || categorySaveState === "saving" || !categoryDirty || !trimmedCategoryDraft}
                  >
                    {categorySaveState === "saving" ? "保存中..." : categorySaveState === "saved" ? "已保存" : "保存类别"}
                  </Button>
                </div>

                {roomCategorySearchOpen && (
                  <div className="category-menu">
                    <div className="category-menu-header">
                      {roomCategoryInputValue.trim() ? "模糊匹配结果" : "Top10 热门种类词"}
                    </div>

                    {roomCategorySuggestions.map((item) => (
                      <Button
                        key={`room-${item.key}`}
                        type="button"
                        variant="ghost"
                        size="sm"
                        className={`category-option${trimmedCategoryDraft === item.subcategoryDisplayName ? " active" : ""}`}
                        onClick={() => {
                          const nextCategory = item.subcategoryDisplayName;
                          setRoomCategoryDraftValue(nextCategory);
                          setRoomCategorySearchOpen(false);
                        }}
                      >
                        <div className="category-option-title">{item.subcategoryDisplayName}</div>
                        <div className="category-option-meta">
                          {item.categoryDisplayName}
                          {item.examples.length > 0 ? ` · 例：${item.examples.join(" vs ")}` : ""}
                          {item.usageCount > 0 ? ` · 热度 ${item.usageCount}` : ""}
                        </div>
                      </Button>
                    ))}

                    {roomCategoryInputValue.trim() && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="category-option custom"
                        onClick={() => {
                          const custom = roomCategoryInputValue.trim();
                          setRoomCategoryDraftValue(custom);
                          setRoomCategorySearchOpen(false);
                        }}
                      >
                        使用“{roomCategoryInputValue.trim()}”作为自定义类别
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}

            {canEditRoomConfig && showHostSettingsPanel && (
              <div className="inline-row room-category-editor">
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={undercoverCountInputValue}
                  onChange={(event) => {
                    const nextValue = event.target.value.replace(/[^\d]/g, "");
                    setUndercoverCountDraftInputValue(nextValue);
                  }}
                  placeholder="卧底人数（1-3）"
                />
                <Button
                  type="button"
                  variant="ghost"
                  className={`${undercoverSaveState === "saving" ? "loading" : ""}${undercoverSaveState === "saved" ? " saved" : ""}`.trim() || undefined}
                  onClick={async () => {
                    if (undercoverCountDraft == null) {
                      roomLogic.setError("请输入 1 到 3 的卧底人数。");
                      return;
                    }

                    setUndercoverSaveState("saving");
                    const ok = await roomLogic.updateUndercoverCount(roomId, undercoverCountDraft);
                    if (ok) {
                      setUndercoverCountDraftInputValue(null);
                      setUndercoverSaveState("saved");
                      if (undercoverSaveResetTimerRef.current != null) {
                        window.clearTimeout(undercoverSaveResetTimerRef.current);
                      }
                      undercoverSaveResetTimerRef.current = window.setTimeout(() => {
                        setUndercoverSaveState("idle");
                        undercoverSaveResetTimerRef.current = null;
                      }, 1200);
                    } else {
                      setUndercoverSaveState("idle");
                    }
                  }}
                  disabled={roomLogic.busy || undercoverSaveState === "saving" || !undercoverCountDirty || undercoverCountDraft == null}
                >
                  {undercoverSaveState === "saving" ? "保存中..." : undercoverSaveState === "saved" ? "已保存" : "保存卧底人数"}
                </Button>
              </div>
            )}

            {canEditRoomConfig && showHostSettingsPanel && (
              <div className="inline-row room-category-editor">
                <label className="field-label-inline">
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
                      safeSetLocalValue(`${WHITEBOARD_COUNT_STORAGE_PREFIX}${roomId}`, String(nextValue));
                    }}
                  />
                </label>
              </div>
            )}

            {canEditRoomConfig && showHostSettingsPanel && whiteboardDisabledByThreePlayerMode && (
              <p className="hint">3 人局暂不支持白板，已自动禁用。</p>
            )}

            {canEditRoomConfig && showHostSettingsPanel && (
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
                <Button
                  type="button"
                  variant="ghost"
                  className={`${voteDurationSaveState === "saving" ? "loading" : ""}${voteDurationSaveState === "saved" ? " saved" : ""}`.trim() || undefined}
                  onClick={async () => {
                    if (voteDurationDraft == null) {
                      roomLogic.setError("请输入大于等于 0 秒的投票时长。");
                      return;
                    }

                    setVoteDurationSaveState("saving");
                    const ok = await roomLogic.updateVoteDuration(roomId, voteDurationDraft);
                    if (ok) {
                      setVoteDurationDraftInputValue(null);
                      setVoteDurationSaveState("saved");
                      if (voteDurationSaveResetTimerRef.current != null) {
                        window.clearTimeout(voteDurationSaveResetTimerRef.current);
                      }
                      voteDurationSaveResetTimerRef.current = window.setTimeout(() => {
                        setVoteDurationSaveState("idle");
                        voteDurationSaveResetTimerRef.current = null;
                      }, 1200);
                    } else {
                      setVoteDurationSaveState("idle");
                    }
                  }}
                  disabled={roomLogic.busy || voteDurationSaveState === "saving" || !voteDurationDirty || voteDurationDraft == null}
                >
                  {voteDurationSaveState === "saving" ? "保存中..." : voteDurationSaveState === "saved" ? "已保存" : "保存投票时长"}
                </Button>
              </div>
            )}

            {canEditRoomConfig && showHostSettingsPanel && (
              <>
                <div className="inline-row room-category-editor">
                  <label className="field-label-inline">
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
              </>
            )}

            {currentPlayer && (
              <div className="word-card self-word-card">
                <span className="tag">你的身份词</span>
                {room.status === "lobby" ? (
                  <strong className="word-card-lobby-text">{isHost ? "你是房主，准备好后可直接开始本局" : "等待房主开局"}</strong>
                ) : (
                  <div className={`word-card-flip${wordVisible ? " revealed" : ""}`}>
                    <div className="word-card-face word-card-face-front">
                      <p className="word-card-face-hint">点击下方按钮查看你的词</p>
                    </div>
                    <div className="word-card-face word-card-face-back">
                      {isCurrentPlayerWhiteboard ? (
                        <div className="whiteboard-face-content">
                          <div className="whiteboard-ink-card" aria-hidden="true" />
                          <strong className="whiteboard-title">你是白板</strong>
                          <p className="whiteboard-breathing-hint">你没有词，请根据他人描述盲猜。</p>
                        </div>
                      ) : (
                        <strong>{currentPlayer.current_word ?? "暂未发词"}</strong>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="actions-row">
              {room.status !== "lobby" && (
                <Button type="button" variant="secondary" onClick={() => setWordVisible((v) => !v)}>
                  {wordVisible ? "隐藏我的词" : "显示我的词"}
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                onClick={async () => {
                  const success = await roomLogic.leaveRoom(roomId);
                  if (success) {
                    router.replace("/");
                  }
                }}
              >
                退出房间
              </Button>
            </div>

            {isHost && showHostControlPanel && (
              <div className="host-actions acet-card-lift">
                <h3>本局控制</h3>
                <div className="host-control-progress" aria-label="本局状态进度">
                  <div className="host-control-progress-head">
                    <span>当前状态</span>
                    <strong>{hostControlPhaseMeta[hostControlPhase].label}</strong>
                  </div>
                  <div className="host-control-track" aria-hidden="true">
                    <div
                      className={`host-control-fill ${hostControlPhaseMeta[hostControlPhase].tone}`}
                      style={{ width: `${hostControlPhaseMeta[hostControlPhase].progress}%` }}
                    />
                  </div>
                  <p className="host-control-progress-hint">{hostControlPhaseMeta[hostControlPhase].hint}</p>
                  <div className="host-control-steps" aria-hidden="true">
                    {hostControlStepLabels.map((step, index) => {
                      const state =
                        index < hostControlCurrentStepIndex
                          ? "done"
                          : index === hostControlCurrentStepIndex
                            ? "active"
                            : "todo";

                      return (
                        <span key={step.key} className={state}>
                          {step.label}
                        </span>
                      );
                    })}
                  </div>
                </div>
                <div className="actions-row">
                  <Button
                    type="button"
                    variant={room.status === "lobby" || !room.vote_enabled ? "primary" : "secondary"}
                    className={`${roomLogic.busy ? "loading " : ""}${room.status === "lobby" || !room.vote_enabled ? "main-next-action" : ""}`.trim() || undefined}
                    onClick={() =>
                      roomLogic.startRound(roomId, room.category, room.undercover_count, effectiveWhiteboardCount, categories, {
                        provider: "groq",
                        model: effectiveModel,
                      })
                    }
                    disabled={roomLogic.busy || room.status === "voting"}
                  >
                    {roomLogic.busy
                      ? "处理中..."
                      : room.round_number === 0
                        ? "开始本局（AI 生成 1 组词）"
                        : "重开新局（重新生成 1 组词）"}
                  </Button>
                  {room.vote_enabled && room.status === "playing" && (
                    <Button
                      type="button"
                      variant="primary"
                      className={`${roomLogic.busy ? "loading " : ""}main-next-action`.trim()}
                      onClick={() => roomLogic.openVoting(roomId)}
                      disabled={roomLogic.busy}
                    >
                      {roomLogic.busy
                        ? "处理中..."
                        : room.vote_candidate_ids && room.vote_candidate_ids.length > 0
                          ? `开启第 ${room.vote_round} 轮加赛投票`
                          : `开启第 ${room.vote_round} 轮投票`}
                    </Button>
                  )}
                  {room.vote_enabled && room.status === "voting" && (
                    <Button
                      type="button"
                      variant="primary"
                      className={`${roomLogic.busy ? "loading " : ""}main-next-action`.trim()}
                      onClick={async () => {
                        const confirmed = await roomLogic.askForConfirmation({
                          title: "确认强制公布本轮投票结果？",
                          description: "将立即结束当前投票并公布结果，未投票玩家将按当前票面结算。",
                          confirmText: "确认公布",
                          cancelText: "取消",
                          tone: "danger",
                        });

                        if (!confirmed) return;
                        void roomLogic.publishVotingResult(roomId, { force: true });
                      }}
                      disabled={roomLogic.busy}
                    >
                      {roomLogic.busy ? "处理中..." : "强制公布本轮投票结果"}
                    </Button>
                  )}
                </div>
              </div>
            )}
          </article>

          <article className="panel">
            <h2>玩家列表</h2>
            <p className="hint">当前发言顺序（每局自动轮换）：</p>
            <motion.ul className="player-list" layout>
              <AnimatePresence initial={false}>
                {rotatedPlayers.map((player, index) => {
                  const isSelfPlayer = player.session_id === sessionId;
                  const isHostPlayer = room.host_session_id === player.session_id;
                  const isOutPlayer = !player.is_alive;
                  const priority = isSelfPlayer ? 0 : isHostPlayer ? 1 : isOutPlayer ? 3 : 2;
                  const priorityClass = isSelfPlayer
                    ? "self-priority"
                    : isHostPlayer
                      ? "host-priority"
                      : isOutPlayer
                        ? "out-priority"
                        : "normal-priority";

                  return (
                    <motion.li
                      key={player.id}
                      layout
                      layoutId={`player-${player.id}`}
                      className={`${isOutPlayer ? "out " : ""}${priorityClass}`.trim()}
                      style={{ zIndex: 20 - priority }}
                      initial={{ opacity: 0, x: -18 + priority * 3, scale: 0.98 - priority * 0.004 }}
                      animate={{
                        opacity: 1,
                        x: 0,
                        scale: 1,
                        transition: {
                          duration: 0.24,
                          ease: "easeOut",
                          delay: Math.min(0.06, priority * 0.012 + index * 0.008),
                        },
                      }}
                      exit={{
                        opacity: 0,
                        x: 10 + priority * 3,
                        scale: 0.985,
                        transition: { duration: 0.16, ease: "easeIn" },
                      }}
                    >
                    <span className="player-meta">
                      <span className="player-index">玩家{player.seat_no}</span>
                      <span className="player-content">
                        <span className="player-name">
                          {player.name}
                          {isSelfPlayer && <span className="player-badge self">你</span>}
                          {isHostPlayer && <span className="player-badge host">房主</span>}
                        </span>
                        <span className="player-note">
                          发言位次 {index + 1} · {player.is_alive ? "存活" : "出局"}
                          {room.status === "voting" && eligibleVoters.some((item) => item.id === player.id)
                            ? ` · ${votedPlayerIds.has(player.id) ? "已投票" : "未投票"}`
                            : ""}
                        </span>
                      </span>
                    </span>
                    <span className="player-side">
                      {isHost && player.session_id !== sessionId && (
                        <Button
                          type="button"
                          variant="danger"
                          size="sm"
                          className={roomLogic.busy ? "loading" : undefined}
                          onClick={async () => {
                            suppressedLeavePlayerIdsRef.current.add(player.id);
                            const ok = await roomLogic.kickPlayer(roomId, player);
                            if (!ok) {
                              suppressedLeavePlayerIdsRef.current.delete(player.id);
                            }
                          }}
                          disabled={roomLogic.busy}
                        >
                          踢出
                        </Button>
                      )}
                    </span>
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </motion.ul>

            {room.vote_enabled && room.status === "voting" && currentPlayer && (
              <div className="vote-box acet-card-lift">
                <div className="vote-head-row">
                  <h3>本轮投票</h3>
                  <p className="hint vote-head-count">
                    已投票人数：{votedCount}/{eligibleVoters.length}
                  </p>
                </div>

                {voteInlineStatus && <p className="hint vote-inline-hint">{voteInlineStatus}</p>}

                <p className="hint">
                  请选择一个目标，或选择“弃票”后再提交。
                </p>

                {remainingVoteSeconds != null && (
                  <div className="vote-countdown-wrap">
                    <VoteCountdownRing
                      remainingSeconds={remainingVoteSeconds}
                      totalSeconds={Math.max(1, room.vote_duration_seconds ?? 60)}
                    />
                  </div>
                )}

                {room.vote_candidate_ids && room.vote_candidate_ids.length > 0 && (
                  <p className="hint">
                    当前为平票加赛：候选人仅限
                    {tieCandidatePlayers.length > 0
                      ? ` ${tieCandidatePlayers.map((p) => `玩家${p.seat_no} ${p.name}`).join("、")}`
                      : " 平票玩家"}
                    {restrictedTieBreak ? "；仅其余存活玩家可投票。" : "；本轮为全员平票，所有存活玩家可参与复投。"}
                  </p>
                )}

                <div>
                  <p className="vote-candidate-label">选择你怀疑的卧底</p>
                  <div className="vote-candidate-grid" role="radiogroup" aria-label="投票候选区">
                    {voteCandidateOptions.map((option) => {
                      const selected = voteTargetId === option.value;
                      return (
                        <Button
                          key={option.key}
                          type="button"
                          variant={selected ? "primary" : "ghost"}
                          size="sm"
                          className={`vote-candidate-chip${selected ? " selected" : ""}${option.isAbstain ? " abstain" : ""}`}
                          disabled={!canCurrentPlayerVote || roomLogic.busy}
                          aria-pressed={selected}
                          onClick={() => setVoteTargetId(option.value)}
                        >
                          <span className="vote-candidate-title">{option.title}</span>
                          <span className="vote-candidate-meta">{option.meta}</span>
                        </Button>
                      );
                    })}
                  </div>
                </div>

                  {canCurrentPlayerVote && !hasVoteSelection && (
                    <p className="hint vote-gate-hint">请先选择投票对象或“弃票”。</p>
                  )}

                <Button
                  type="button"
                  variant="primary"
                  className={`${roomLogic.busy ? "loading " : ""}main-next-action`.trim()}
                  onClick={async () => {
                    const ok = await roomLogic.castVote(roomId, voteTargetId, voteScopePlayers);
                    if (ok) {
                      setVoteSubmitToast(voteTargetId === ABSTAIN_VOTE_VALUE ? "弃票已提交" : "投票已提交");
                    }
                  }}
                  disabled={roomLogic.busy || !canSubmitVote}
                >
                  {roomLogic.busy ? "提交中..." : "提交/更新我的投票"}
                </Button>
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
                <Button
                  type="button"
                  variant="primary"
                  className={roomLogic.busy ? "loading" : undefined}
                  disabled={roomLogic.busy || !whiteboardGuess.trim()}
                  onClick={() => roomLogic.submitWhiteboardGuess(roomId, whiteboardGuess, "grok")}
                >
                  {roomLogic.busy ? "提交中..." : "提交猜词"}
                </Button>
              </div>
            </div>
          </div>
        )}

        <div className="notice-toast-stack">
          {forcedExitNotice && (
            <NoticeToast type="error" message={forcedExitNotice} onClose={() => {}} />
          )}
          {presenceJoinToast && (
            <NoticeToast
              type="success"
              message={presenceJoinToast}
              durationMs={1800}
              onClose={() => setPresenceJoinToast("")}
            />
          )}
          {presenceLeaveToast && (
            <NoticeToast
              type="info"
              message={presenceLeaveToast}
              durationMs={2000}
              onClose={() => setPresenceLeaveToast("")}
            />
          )}
          {voteSubmitToast && (
            <NoticeToast
              type="success"
              message={voteSubmitToast}
              durationMs={1400}
              onClose={() => setVoteSubmitToast("")}
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
