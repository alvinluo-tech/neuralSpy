"use client";

import { useCallback, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { detectWinnerByRole, validateAndAssignRoles } from "@/lib/gameEngine";
import { trackEvent } from "@/lib/umami";
import { checkClientRateLimit } from "@/lib/clientRateLimit";
import type { Category, Subcategory } from "./useCategorySearch";
import type { RoomRow, PlayerRow } from "./useRoomData";

export const ABSTAIN_VOTE_VALUE = "__ABSTAIN__";
export const ALL_CATEGORY_RANDOM = "全部分类（系统随机）";
export const AI_GENERATING_SUMMARY = "AI 正在生成本局词条，请稍候...";

type ConfirmDialogOptions = {
  title: string;
  description: string;
  confirmText: string;
  cancelText?: string;
  tone?: "neutral" | "danger";
};

type ConfirmDialogState = ConfirmDialogOptions & {
  open: boolean;
};

type RoomWordHistoryRow = {
  pair_key: string;
  civilian: string;
  undercover: string;
};

type GeneratedWordPair = {
  civilian: string;
  undercover: string;
};

type AiProvider = "groq" | "grok";
const DEFAULT_AI_MODEL = "grok-4-1-fast";

type AiFailureStage =
  | "network_error"
  | "http_error"
  | "invalid_payload"
  | "history_insert_error"
  | "exhausted_pairs";

const secureRandomInt = (maxExclusive: number) => {
  if (maxExclusive <= 1) return 0;
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) {
    return Math.floor(Math.random() * maxExclusive);
  }
  const maxUint32 = 4294967296;
  const threshold = Math.floor(maxUint32 / maxExclusive) * maxExclusive;
  const buffer = new Uint32Array(1);
  let value = 0;
  do {
    cryptoApi.getRandomValues(buffer);
    value = buffer[0];
  } while (value >= threshold);
  return value % maxExclusive;
};

const normalizeVoteDurationSeconds = (value: number | null | undefined) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return 60;
  const normalized = Math.trunc(value);
  return normalized >= 0 ? normalized : 0;
};


const normalizePairKey = (pair: { civilian: string; undercover: string }) => {
  const left = pair.civilian.trim().toLowerCase();
  const right = pair.undercover.trim().toLowerCase();
  return [left, right].sort().join("||");
};

const MODEL_EVENT_PREFIX_ALIASES: Record<string, string> = {
  AI_Word_Generation_Attempt: "AIWG_Attempt",
  AI_Word_Generation_Success: "AIWG_Success",
  AI_Word_Generation_Failure: "AIWG_Failure",
  AI_Word_Generation_Rejected_Duplicate: "AIWG_RejDup",
};

const toEventToken = (value: string | undefined, fallback: string) => {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) return fallback;
  const token = normalized.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return token || fallback;
};

const toModelEventToken = (model: string | undefined) => {
  const normalized = (model ?? "").trim().toLowerCase();
  if (!normalized) return "unk";

  return toEventToken(normalized, "unk");
};

const trackAiEvent = (
  baseEventName: string,
  payload: Record<string, string | number | boolean | null | undefined>,
  provider: string | undefined,
  model: string | undefined,
  options?: {
    emitBaseEvent?: boolean;
  },
) => {
  const emitBaseEvent = options?.emitBaseEvent ?? false;
  if (emitBaseEvent) {
    trackEvent(baseEventName, payload);
  }

  const resolvedModel = model?.trim() || DEFAULT_AI_MODEL;

  const providerToken = toEventToken(provider, "groq");
  const modelToken = toModelEventToken(resolvedModel);
  const modelEventPrefix = MODEL_EVENT_PREFIX_ALIASES[baseEventName] ?? baseEventName;

  trackEvent(`${modelEventPrefix}_${providerToken}_${modelToken}`, payload);
};

export const useRoomLogic = (
  sessionId: string,
  room: RoomRow | null,
  players: PlayerRow[],
  options?: {
    refreshRoom?: () => Promise<void> | void;
  }
) => {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [generatingWords, setGeneratingWords] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>({
    open: false,
    title: "",
    description: "",
    confirmText: "确认",
    cancelText: "取消",
    tone: "neutral",
  });
  const confirmResolverRef = useRef<((accepted: boolean) => void) | null>(null);

  const isHost = room?.host_session_id === sessionId;
  const currentPlayer = players.find((p) => p.session_id === sessionId);

  const askForConfirmation = useCallback((options: ConfirmDialogOptions) => {
    return new Promise<boolean>((resolve) => {
      confirmResolverRef.current = resolve;
      setConfirmDialog({
        open: true,
        title: options.title,
        description: options.description,
        confirmText: options.confirmText,
        cancelText: options.cancelText ?? "取消",
        tone: options.tone ?? "neutral",
      });
    });
  }, []);

  const resolveConfirmation = useCallback((accepted: boolean) => {
    setConfirmDialog((prev) => ({ ...prev, open: false }));
    if (confirmResolverRef.current) {
      confirmResolverRef.current(accepted);
      confirmResolverRef.current = null;
    }
  }, []);

  const startRound = useCallback(
    async (
      roomId: string,
      category: string,
      undercoverCount: number,
      whiteboardCount: number,
      allCategories: Category[],
      aiOptions?: {
        provider?: AiProvider;
        model?: string;
      }
    ): Promise<{ success: boolean; message: string }> => {
      if (!room || !isHost) {
        setError("仅房主可开局。");
        return { success: false, message: "房主权限不足" };
      }
      if (players.length < 3) {
        setError("当前人数不足 3 人，无法开局。");
        return { success: false, message: "至少 3 人才能开局" };
      }

      if (!checkClientRateLimit("startRound", 15, 60000)) {
        setError("开局过于频繁，请稍候再试。");
        return { success: false, message: "限流触发" };
      }

      setBusy(true);
      setGeneratingWords(true);
      setError("");
      setMessage("");

      try {
        const markGenerating = await supabase
          .from("rooms")
          .update({ result_summary: AI_GENERATING_SUMMARY })
          .eq("id", roomId);

        if (markGenerating.error) {
          throw new Error(markGenerating.error.message);
        }

        const categoryPool = allCategories.flatMap((cat) =>
          (cat.category_subcategories ?? []).map((sub: Subcategory) => sub.display_name)
        );

        const isRandomAllMode = category === ALL_CATEGORY_RANDOM;
        const pickedCategory = isRandomAllMode
          ? categoryPool[secureRandomInt(Math.max(categoryPool.length, 1))]
          : category;

        if (!pickedCategory) {
          throw new Error("随机类别池为空，请先初始化分类库。");
        }

        const historyRes = await supabase
          .from("room_word_history")
          .select("pair_key, civilian, undercover")
          .eq("room_id", roomId)
          .eq("category", pickedCategory);

        if (historyRes.error) {
          throw new Error(historyRes.error.message);
        }

        const historyRows = (historyRes.data ?? []) as RoomWordHistoryRow[];
        const usedKeys = new Set(historyRows.map((row) => row.pair_key));
        const excludedPairs = historyRows.map((row) => `${row.civilian}/${row.undercover}`);

        let acceptedPair: { civilian: string; undercover: string } | null = null;
        let lastAttemptProvider = "groq";
        let lastAttemptModel = DEFAULT_AI_MODEL;

        for (let attempt = 0; attempt < 6; attempt += 1) {
          const requestBody: {
            category: string;
            excludedPairs: string[];
            provider?: AiProvider;
            model?: string;
            tracking?: {
              room_id: string;
              round_number: number;
              attempt: number;
              is_random_all_mode: boolean;
              category: string;
              provider: string;
              model: string | undefined;
            };
          } = {
            category: pickedCategory,
            excludedPairs,
          };

          if (aiOptions?.provider) {
            requestBody.provider = aiOptions.provider;
          }

          const requestedModel = aiOptions?.model?.trim();
          requestBody.model = requestedModel && requestedModel.length > 0
            ? requestedModel
            : DEFAULT_AI_MODEL;

          const requestProviderName = requestBody.provider ?? "groq";
          const requestModelName = requestBody.model;
          lastAttemptProvider = requestProviderName;
          lastAttemptModel = requestModelName;

          const trackingBasePayload = {
            room_id: roomId,
            round_number: room.round_number + 1,
            category: pickedCategory,
            attempt: attempt + 1,
            is_random_all_mode: isRandomAllMode,
            provider: requestProviderName,
            model: requestModelName,
          };

          requestBody.tracking = trackingBasePayload;

          trackAiEvent(
            "AI_Word_Generation_Attempt",
            trackingBasePayload,
            requestProviderName,
            requestModelName,
            { emitBaseEvent: false },
          );

          let response: Response;
          try {
            response = await fetch("/api/grok/words", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(requestBody),
            });
          } catch (networkErr) {
            const networkErrorMessage =
              networkErr instanceof Error ? networkErr.message : "网络请求失败";
            trackAiEvent(
              "AI_Word_Generation_Failure",
              {
                ...trackingBasePayload,
                failure_stage: "network_error" as AiFailureStage,
                http_status: 0,
                error: networkErrorMessage,
              },
              requestProviderName,
              requestModelName,
            );
            throw new Error(networkErrorMessage);
          }

          let data: {
            pair?: GeneratedWordPair;
            error?: string;
            provider?: string;
            model?: string;
          } = {};

          try {
            data = (await response.json()) as {
              pair?: GeneratedWordPair;
              error?: string;
              provider?: string;
              model?: string;
            };
          } catch {
            data = {
              error: `AI 响应解析失败（HTTP ${response.status}）`,
            };
          }

          const providerName = data.provider ?? requestProviderName;
          const modelName = data.model ?? requestBody.model;
          lastAttemptProvider = providerName;
          lastAttemptModel = modelName ?? lastAttemptModel;

          if (!response.ok || !data.pair) {
            const failureError = data.error ?? `AI 词条生成失败（HTTP ${response.status}）`;
            const failureStage: AiFailureStage = !response.ok ? "http_error" : "invalid_payload";
            trackAiEvent(
              "AI_Word_Generation_Failure",
              {
                ...trackingBasePayload,
                provider: providerName,
                model: modelName,
                failure_stage: failureStage,
                http_status: response.status,
                error: failureError,
              },
              providerName,
              modelName,
            );
            throw new Error(failureError);
          }

          const pairKey = normalizePairKey(data.pair);
          if (usedKeys.has(pairKey)) {
            trackAiEvent(
              "AI_Word_Generation_Rejected_Duplicate",
              {
                ...trackingBasePayload,
                provider: providerName,
                model: modelName,
                reason: "memory_hit",
              },
              providerName,
              modelName,
            );
            continue;
          }

          const insertHistory = await supabase.from("room_word_history").insert({
            room_id: roomId,
            category: pickedCategory,
            pair_key: pairKey,
            civilian: data.pair.civilian,
            undercover: data.pair.undercover,
            round_number: room.round_number + 1,
          });

          if (insertHistory.error) {
            if (insertHistory.error.code === "23505") {
              trackAiEvent(
                "AI_Word_Generation_Rejected_Duplicate",
                {
                  ...trackingBasePayload,
                  provider: providerName,
                  model: modelName,
                  reason: "history_unique_conflict",
                },
                providerName,
                modelName,
              );
              usedKeys.add(pairKey);
              continue;
            }
            trackAiEvent(
              "AI_Word_Generation_Failure",
              {
                ...trackingBasePayload,
                provider: providerName,
                model: modelName,
                failure_stage: "history_insert_error" as AiFailureStage,
                http_status: 0,
                error: insertHistory.error.message,
              },
              providerName,
              modelName,
            );
            throw new Error(insertHistory.error.message);
          }

          acceptedPair = data.pair;
          break;
        }

        if (!acceptedPair) {
          trackAiEvent(
            "AI_Word_Generation_Failure",
            {
              room_id: roomId,
              round_number: room.round_number + 1,
              category: pickedCategory,
              attempt: 6,
              is_random_all_mode: isRandomAllMode,
              provider: lastAttemptProvider,
              model: lastAttemptModel,
              failure_stage: "exhausted_pairs" as AiFailureStage,
              http_status: 0,
              error: "该类别可用词组已耗尽，请修改类别后再开局。",
            },
            lastAttemptProvider,
            lastAttemptModel,
          );
          throw new Error("该类别可用词组已耗尽，请修改类别后再开局。");
        }

        const sortedPlayers = [...players].sort((a, b) => a.seat_no - b.seat_no);
        const nextRound = room.round_number + 1;
        const firstSpeakerPlayerId =
          sortedPlayers.length > 0
            ? sortedPlayers[Math.max(nextRound - 1, 0) % sortedPlayers.length]?.id
            : undefined;

        const rolePlan = validateAndAssignRoles(
          sortedPlayers.map((player) => player.id),
          undercoverCount,
          whiteboardCount,
          { firstSpeakerPlayerId },
        );

        const undercoverIds = rolePlan.spyIds;
        const whiteboardIds = rolePlan.whiteboardIds;

        await supabase
          .from("players")
          .update({
            is_undercover: false,
            is_alive: true,
            current_word: acceptedPair.civilian,
          })
          .eq("room_id", roomId);

        await supabase
          .from("players")
          .update({
            is_undercover: true,
            current_word: acceptedPair.undercover,
          })
          .in("id", undercoverIds);

        if (whiteboardIds.length > 0) {
          await supabase
            .from("players")
            .update({
              is_undercover: false,
              current_word: null,
            })
            .in("id", whiteboardIds);
        }

        await supabase
          .from("rooms")
          .update({
            status: "playing",
            round_number: room.round_number + 1,
            vote_round: 1,
            vote_started_at: null,
            vote_deadline_at: null,
            vote_candidate_ids: null,
            last_eliminated_player_id: null,
            result_summary:
              whiteboardIds.length > 0
                ? `本局已开始，系统已发词（含 ${whiteboardIds.length} 名白板）。`
                : "本局已开始，系统已为每位玩家发词。",
          })
          .eq("id", roomId);

        const modeTip =
          players.length === 3 && whiteboardCount > 0
            ? "3 人局已自动关闭白板。"
            : whiteboardIds.length > 0
              ? `本局含 ${whiteboardIds.length} 名白板。`
              : "本局无白板。";

        setMessage(
          isRandomAllMode
            ? `本局已开，系统随机类别：${pickedCategory}。AI 已生成 1 组词并发词。${modeTip}`
            : `本局已开，AI 仅生成 1 组词并已发词。${modeTip}`
        );

        trackEvent("Room_Config", {
          players_count: players.length,
          has_whiteboard: whiteboardIds.length > 0,
          whiteboard_count: whiteboardIds.length,
          vote_enabled: room.vote_enabled,
          vote_duration_seconds: room.vote_duration_seconds ?? 60,
          undercover_count: rolePlan.normalizedSpyCount,
          category: pickedCategory,
        });

        return { success: true, message: "开局成功" };
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "开局失败";
        setError(errMsg);
        await supabase
          .from("rooms")
          .update({ result_summary: `开局失败：${errMsg}` })
          .eq("id", roomId);
        return { success: false, message: errMsg };
      } finally {
        setGeneratingWords(false);
        setBusy(false);
        await options?.refreshRoom?.();
      }
    },
    [room, isHost, players, options]
  );

  const openVoting = useCallback(
    async (roomId: string): Promise<boolean> => {
      if (!room || !isHost) return false;

      setBusy(true);
      setError("");

      const now = new Date();
      const duration = normalizeVoteDurationSeconds(room.vote_duration_seconds);
      const deadline = new Date(now.getTime() + duration * 1000).toISOString();
      const aliveCount = players.filter((player) => player.is_alive).length;
      const candidateCount = room.vote_candidate_ids?.length ?? 0;
      const restrictedTieBreak = candidateCount > 0 && candidateCount < aliveCount;

      const update = await supabase
        .from("rooms")
        .update({
          status: "voting",
          vote_started_at: now.toISOString(),
          vote_deadline_at: deadline,
          vote_candidate_ids: room.vote_candidate_ids,
          result_summary:
            room.vote_candidate_ids && room.vote_candidate_ids.length > 0
              ? restrictedTieBreak
                ? `第 ${room.vote_round} 轮加赛投票进行中（限时 ${duration} 秒，仅非平票玩家可投票）`
                : `第 ${room.vote_round} 轮全员平票复投进行中（限时 ${duration} 秒，所有存活玩家可投票）`
              : `第 ${room.vote_round} 轮投票进行中（限时 ${duration} 秒）`,
        })
        .eq("id", roomId);

      if (update.error) {
        setError(update.error.message);
        setBusy(false);
        return false;
      }

      setMessage(`已开启第 ${room.vote_round} 轮投票。`);
      setBusy(false);
      await options?.refreshRoom?.();
      return true;
    },
    [room, isHost, players, options]
  );

  const castVote = useCallback(
    async (
      roomId: string,
      voteTargetId: string,
      voteScopePlayers: PlayerRow[]
    ): Promise<boolean> => {
      if (!room || !currentPlayer) {
        setError("请选择投票目标。");
        return false;
      }

      const isAbstainVote = voteTargetId === ABSTAIN_VOTE_VALUE;
      if (!isAbstainVote && !voteTargetId) {
        setError("请选择投票目标或选择弃票。");
        return false;
      }

      if (!isAbstainVote && currentPlayer.id === voteTargetId) {
        setError("不能投自己。");
        return false;
      }

      const scopeIds = new Set(voteScopePlayers.map((p) => p.id));
      if (!isAbstainVote && !scopeIds.has(voteTargetId)) {
        setError("当前轮次只能投指定候选人。请刷新后重试。");
        return false;
      }

      setBusy(true);
      setError("");

      const upsertRes = await supabase.from("votes").upsert(
        {
          room_id: room.id,
          round_number: room.round_number,
          vote_round: room.vote_round,
          voter_player_id: currentPlayer.id,
          target_player_id: isAbstainVote ? null : voteTargetId,
        },
        { onConflict: "room_id,round_number,vote_round,voter_player_id" }
      );

      if (upsertRes.error) {
        setError(upsertRes.error.message);
        setBusy(false);
        return false;
      }

      setBusy(false);
      await options?.refreshRoom?.();
      return true;
    },
    [room, currentPlayer, options]
  );

  const publishVotingResult = useCallback(
    async (
      roomId: string,
      publishOptions?: { force?: boolean; silentNoop?: boolean }
    ): Promise<{ ok: boolean; action: string; reason?: string; eliminatedRole?: string }> => {
      if (!room) return { ok: false, action: "noop", reason: "missing-room" };

      setBusy(true);
      setError("");

      try {
        const response = await fetch(`/api/rooms/${roomId}/settle-vote`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedRound: room.round_number,
            expectedVoteRound: room.vote_round,
            force: !!publishOptions?.force,
          }),
        });

        const result = (await response.json()) as {
          ok?: boolean;
          action?: string;
          reason?: string;
          error?: string;
          eliminatedRole?: string;
          winner?: string;
        };

        if (!response.ok) {
          throw new Error(result.error ?? "服务端结算失败");
        }

        if (result.action === "revote-no-votes" || result.action === "revote-no-votes-pending") {
          setMessage("本轮无人有效投票（可能全员弃票），已进入讨论阶段，请房主开启下一轮投票。");
          return { ok: false, action: result.action };
        }

        if (result.action === "revote-tie" || result.action === "revote-tie-pending") {
          setMessage("本轮出现平票，已进入讨论阶段，请房主开启加赛投票。");
          return { ok: false, action: result.action };
        }

        if (result.action === "noop") {
          if (!publishOptions?.silentNoop) {
            if (publishOptions?.force) {
              setMessage("当前轮次状态已变化或已结算，请刷新后重试。");
            } else {
              setMessage("尚未到投票截止且未全员投票，暂不结算。");
            }
          }
          return { ok: false, action: "noop", reason: result.reason };
        }

        if (result.action === "finished") {
          const roleInfo = result.eliminatedRole ? `出局玩家身份：${result.eliminatedRole}。` : "";
          setMessage(`投票已自动结算，游戏已结束。${roleInfo}`);
          return { ok: true, action: "finished", eliminatedRole: result.eliminatedRole };
        }

        if (result.action === "whiteboard-guess-pending") {
          setMessage(`白板已出局，进入临终猜词阶段。请白板玩家提交猜词。`);
          return { ok: true, action: "whiteboard-guess-pending", eliminatedRole: result.eliminatedRole };
        }

        if (result.action === "eliminated") {
          const roleInfo = result.eliminatedRole ? `（身份：${result.eliminatedRole}）` : "";
          setMessage(`投票已自动结算，已淘汰一名玩家${roleInfo}。`);
          return { ok: true, action: "eliminated", eliminatedRole: result.eliminatedRole };
        }

        return { ok: false, action: result.action ?? "unknown" };
      } catch (err) {
        setError(err instanceof Error ? err.message : "公布失败");
        return { ok: false, action: "error", reason: err instanceof Error ? err.message : "unknown" };
      } finally {
        setBusy(false);
        await options?.refreshRoom?.();
      }
    },
    [room, options]
  );

  const submitWhiteboardGuess = useCallback(
    async (roomId: string, guess: string, provider: "grok" | "gemini" = "grok"): Promise<boolean> => {
      if (!room || !currentPlayer) return false;

      const normalizedGuess = guess.trim();
      if (!normalizedGuess) {
        setError("请输入你猜测的平民词。");
        return false;
      }

      setBusy(true);
      setError("");

      try {
        const response = await fetch(`/api/rooms/${roomId}/whiteboard-guess`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            playerId: currentPlayer.id,
            guess: normalizedGuess,
            provider,
          }),
        });

        const result = (await response.json()) as {
          ok?: boolean;
          action?: string;
          error?: string;
          winner?: string;
        };

        if (!response.ok) {
          throw new Error(result.error ?? "白板猜词提交失败");
        }

        if (result.action === "whiteboard-solo-win") {
          setMessage("白板猜词成功，白板单独获胜！");
          return true;
        }

        if (result.action === "whiteboard-guess-failed") {
          setMessage(result.winner ? `白板猜词失败。当前胜方：${result.winner}阵营。` : "白板猜词失败，游戏继续。");
          return true;
        }

        if (result.action === "noop") {
          setMessage("当前没有可提交的白板猜词。");
          return false;
        }

        return false;
      } catch (err) {
        setError(err instanceof Error ? err.message : "白板猜词提交失败");
        return false;
      } finally {
        setBusy(false);
        await options?.refreshRoom?.();
      }
    },
    [room, currentPlayer, options],
  );

  const leaveRoom = useCallback(
    async (roomId: string): Promise<boolean> => {
      const confirmed = await askForConfirmation(
        isHost
          ? {
              title: "确认解散房间？",
              description: "你是房主，退出后将解散整个房间并清空本局数据。",
              confirmText: "确认解散",
              cancelText: "再想想",
              tone: "danger",
            }
          : {
              title: "确认退出房间？",
              description: "退出后你将离开当前房间。",
              confirmText: "确认退出",
              cancelText: "取消",
              tone: "neutral",
            }
      );

      if (!confirmed) return false;

      setBusy(true);
      setError("");

      try {
        if (isHost) {
          await supabase.from("rooms").delete().eq("id", roomId);
        } else if (currentPlayer) {
          await supabase.from("players").delete().eq("id", currentPlayer.id);
        }
        await options?.refreshRoom?.();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "退出房间失败");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [isHost, currentPlayer, askForConfirmation, options]
  );

  const kickPlayer = useCallback(
    async (roomId: string, targetPlayer: PlayerRow): Promise<boolean> => {
      if (!room || !isHost || targetPlayer.session_id === sessionId) {
        return false;
      }

      const confirmed = await askForConfirmation({
        title: "确认踢出玩家？",
        description: `确认将玩家 玩家${targetPlayer.seat_no}（${targetPlayer.name}）移出房间吗？`,
        confirmText: "确认踢出",
        cancelText: "取消",
        tone: "danger",
      });

      if (!confirmed) return false;

      setBusy(true);
      setError("");

      try {
        await supabase.from("players").delete().eq("id", targetPlayer.id);

        if (room.status !== "lobby") {
          const nextPlayers = players.filter((p) => p.id !== targetPlayer.id);
          const winner = detectWinnerByRole(nextPlayers);

          if (winner) {
            await supabase
              .from("rooms")
              .update({
                status: "finished",
                result_summary: `玩家 ${targetPlayer.seat_no}（${targetPlayer.name}）被移出。最终胜方：${winner}阵营。`,
              })
              .eq("id", roomId);
          } else {
            await supabase
              .from("rooms")
              .update({
                result_summary: `玩家 ${targetPlayer.seat_no}（${targetPlayer.name}）被房主移出。`,
              })
              .eq("id", roomId);
          }
        }

        setMessage(`已将玩家 ${targetPlayer.seat_no}（${targetPlayer.name}）移出房间。`);
        await options?.refreshRoom?.();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "踢人失败");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [room, isHost, sessionId, players, askForConfirmation, options]
  );

  const updateRoomCategory = useCallback(
    async (roomId: string, newCategory: string): Promise<boolean> => {
      if (!room || !isHost) return false;

      const category = newCategory.trim();
      if (!category) {
        setError("类别不能为空。");
        return false;
      }

      setBusy(true);
      setError("");

      const update = await supabase.from("rooms").update({ category }).eq("id", roomId);

      if (update.error) {
        setError(update.error.message);
        setBusy(false);
        return false;
      }

      setMessage(`类别已更新为：${category}`);
      setBusy(false);
      await options?.refreshRoom?.();
      return true;
    },
    [room, isHost, options]
  );

  const updateUndercoverCount = useCallback(
    async (roomId: string, count: number): Promise<boolean> => {
      if (!room || !isHost) return false;

      if (!Number.isFinite(count)) {
        setError("卧底人数格式无效。");
        return false;
      }

      const undercoverCount = Math.trunc(count);
      if (undercoverCount < 1 || undercoverCount > 3) {
        setError("卧底人数必须在 1 到 3 之间。");
        return false;
      }

      setBusy(true);
      setError("");

      const update = await supabase.from("rooms").update({ undercover_count: undercoverCount }).eq("id", roomId);

      if (update.error) {
        setError(update.error.message);
        setBusy(false);
        return false;
      }

      setMessage(`卧底人数已更新为 ${undercoverCount} 人。`);
      setBusy(false);
      await options?.refreshRoom?.();
      return true;
    },
    [room, isHost, options]
  );

  const updateVoteDuration = useCallback(
    async (roomId: string, seconds: number): Promise<boolean> => {
      if (!room || !isHost) return false;

      if (!Number.isFinite(seconds)) {
        setError("投票时长格式无效。");
        return false;
      }

      const duration = Math.trunc(seconds);
      if (duration < 0) {
        setError("投票时长必须大于等于 0 秒。");
        return false;
      }

      setBusy(true);
      setError("");

      const update = await supabase.from("rooms").update({ vote_duration_seconds: duration }).eq("id", roomId);

      if (update.error) {
        setError(update.error.message);
        setBusy(false);
        return false;
      }

      setMessage(`投票时长已更新为 ${duration} 秒。`);
      setBusy(false);
      await options?.refreshRoom?.();
      return true;
    },
    [room, isHost, options]
  );

  return {
    message,
    error,
    busy,
    generatingWords,
    confirmDialog,
    isHost,
    currentPlayer,
    startRound,
    openVoting,
    castVote,
    publishVotingResult,
    submitWhiteboardGuess,
    leaveRoom,
    kickPlayer,
    updateRoomCategory,
    updateUndercoverCount,
    updateVoteDuration,
    askForConfirmation,
    resolveConfirmation,
    setMessage,
    setError,
  };
};
