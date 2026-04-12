"use client";

import { useCallback, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
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

const randomCode = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
};

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

const clamp = (value: number, min: number, max: number) => {
  return Math.min(Math.max(value, min), max);
};

const undercoverKey = (ids: string[]) => {
  return [...ids].sort().join("|");
};

const pickUndercoverIds = (players: PlayerRow[], undercoverCount: number, previousKey?: string) => {
  const pool = [...players.map((player) => player.id)];
  if (undercoverCount >= pool.length) {
    return pool;
  }

  let fallback = pool.slice(0, undercoverCount);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const shuffled = [...pool];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = secureRandomInt(i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const candidate = shuffled.slice(0, undercoverCount);
    fallback = candidate;
    if (!previousKey || undercoverKey(candidate) !== previousKey) {
      return candidate;
    }
  }

  return fallback;
};

const detectWinner = (players: PlayerRow[]) => {
  const aliveUndercover = players.filter((player) => player.is_alive && player.is_undercover).length;
  const aliveCivilian = players.filter((player) => player.is_alive && !player.is_undercover).length;

  if (aliveUndercover === 0) return "平民" as const;
  if (aliveUndercover >= aliveCivilian) return "卧底" as const;
  return null;
};

const normalizePairKey = (pair: { civilian: string; undercover: string }) => {
  const left = pair.civilian.trim().toLowerCase();
  const right = pair.undercover.trim().toLowerCase();
  return [left, right].sort().join("||");
};

export const useRoomLogic = (
  sessionId: string,
  room: RoomRow | null,
  players: PlayerRow[],
  categories: any[],
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
      allCategories: any[]
    ): Promise<{ success: boolean; message: string }> => {
      if (!room || !isHost) {
        setError("仅房主可开局。");
        return { success: false, message: "房主权限不足" };
      }
      if (players.length < 3) {
        setError("当前人数不足 3 人，无法开局。");
        return { success: false, message: "至少 3 人才能开局" };
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
          (cat.category_subcategories ?? []).map((sub: any) => sub.display_name)
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

        const usedKeys = new Set((historyRes.data ?? []).map((row: any) => row.pair_key));
        const excludedPairs = (historyRes.data ?? []).map(
          (row: any) => `${row.civilian}/${row.undercover}`
        );

        let acceptedPair: { civilian: string; undercover: string } | null = null;

        for (let attempt = 0; attempt < 6; attempt += 1) {
          const response = await fetch("/api/grok/words", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              category: pickedCategory,
              excludedPairs,
            }),
          });

          const data = (await response.json()) as { pair?: any; error?: string };
          if (!response.ok || !data.pair) {
            throw new Error(data.error ?? "AI 词条生成失败");
          }

          const pairKey = normalizePairKey(data.pair);
          if (usedKeys.has(pairKey)) {
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
              usedKeys.add(pairKey);
              continue;
            }
            throw new Error(insertHistory.error.message);
          }

          acceptedPair = data.pair;
          break;
        }

        if (!acceptedPair) {
          throw new Error("该类别可用词组已耗尽，请修改类别后再开局。");
        }

        const currentUndercoverCount = clamp(undercoverCount, 1, Math.max(players.length - 1, 1));
        const previousUndercover = players.filter((p) => p.is_undercover).map((p) => p.id);
        const previousKey = room.round_number > 0 ? undercoverKey(previousUndercover) : undefined;
        const undercoverIds = pickUndercoverIds(players, currentUndercoverCount, previousKey);

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
            result_summary: "本局已开始，系统已为每位玩家发词。",
          })
          .eq("id", roomId);

        setMessage(
          isRandomAllMode
            ? `本局已开，系统随机类别：${pickedCategory}。AI 已生成 1 组词并发词。`
            : "本局已开，AI 仅生成 1 组词并已发词。"
        );

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
      const duration = clamp(room.vote_duration_seconds ?? 60, 15, 600);
      const deadline = new Date(now.getTime() + duration * 1000).toISOString();

      const update = await supabase
        .from("rooms")
        .update({
          status: "voting",
          vote_started_at: now.toISOString(),
          vote_deadline_at: deadline,
          vote_candidate_ids: room.vote_candidate_ids,
          result_summary:
            room.vote_candidate_ids && room.vote_candidate_ids.length > 0
              ? `第 ${room.vote_round} 轮加赛投票进行中（限时 ${duration} 秒，仅非平票玩家可投票）`
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
    [room, isHost, options]
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

      setMessage(
        isAbstainVote ? "你已选择弃票，系统已记录。重复投票会覆盖你上一票。" : "投票成功，已记录。重复投票会覆盖你上一票。"
      );
      setBusy(false);
      await options?.refreshRoom?.();
      return true;
    },
    [room, currentPlayer, options]
  );

  const publishVotingResult = useCallback(
    async (roomId: string): Promise<boolean> => {
      if (!room) return false;

      setBusy(true);
      setError("");

      try {
        const response = await fetch(`/api/rooms/${roomId}/settle-vote`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedRound: room.round_number,
            expectedVoteRound: room.vote_round,
          }),
        });

        const result = (await response.json()) as {
          ok?: boolean;
          action?: string;
          reason?: string;
          error?: string;
        };

        if (!response.ok) {
          throw new Error(result.error ?? "服务端结算失败");
        }

        if (result.action === "revote-no-votes" || result.action === "revote-no-votes-pending") {
          setMessage("本轮无人有效投票（可能全员弃票），已进入讨论阶段，请房主开启下一轮投票。");
          return false;
        }

        if (result.action === "revote-tie" || result.action === "revote-tie-pending") {
          setMessage("本轮出现平票，已进入讨论阶段，请房主开启加赛投票。");
          return false;
        }

        if (result.action === "noop") {
          setMessage("尚未到投票截止且未全员投票，暂不结算。");
          return false;
        }

        if (result.action === "finished") {
          setMessage("投票已自动结算，游戏已结束。");
          return true;
        }

        if (result.action === "eliminated") {
          setMessage("投票已自动结算，已淘汰一名玩家。");
          return true;
        }

        return false;
      } catch (err) {
        setError(err instanceof Error ? err.message : "公布失败");
        return false;
      } finally {
        setBusy(false);
        await options?.refreshRoom?.();
      }
    },
    [room, options]
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
        description: `确认将玩家 #${targetPlayer.seat_no}（${targetPlayer.name}）移出房间吗？`,
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
          const winner = detectWinner(nextPlayers);

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

  const updateVoteDuration = useCallback(
    async (roomId: string, seconds: number): Promise<boolean> => {
      if (!room || !isHost) return false;

      const duration = clamp(seconds, 15, 600);
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
    leaveRoom,
    kickPlayer,
    updateRoomCategory,
    updateVoteDuration,
    askForConfirmation,
    resolveConfirmation,
    setMessage,
    setError,
  };
};
