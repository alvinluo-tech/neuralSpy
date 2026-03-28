"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type RoomRow = {
  id: string;
  code: string;
  host_session_id: string;
  status: "lobby" | "playing" | "voting" | "finished";
  category: string;
  undercover_count: number;
  vote_enabled: boolean;
  round_number: number;
  vote_round: number;
  last_eliminated_player_id: string | null;
  result_summary: string | null;
};

type PlayerRow = {
  id: string;
  room_id: string;
  session_id: string;
  name: string;
  seat_no: number;
  is_undercover: boolean;
  is_alive: boolean;
  current_word: string | null;
};

type VoteRow = {
  id: string;
  room_id: string;
  round_number: number;
  vote_round: number;
  voter_player_id: string;
  target_player_id: string;
};

type WordPair = {
  civilian: string;
  undercover: string;
};

const SESSION_KEY = "undercover.session.id";

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

const pickUndercoverIds = (players: PlayerRow[], undercoverCount: number) => {
  const pool = [...players.map((player) => player.id)];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, undercoverCount);
};

const detectWinner = (players: PlayerRow[]) => {
  const aliveUndercover = players.filter((player) => player.is_alive && player.is_undercover).length;
  const aliveCivilian = players.filter((player) => player.is_alive && !player.is_undercover).length;

  if (aliveUndercover === 0) return "平民" as const;
  if (aliveUndercover >= aliveCivilian) return "卧底" as const;
  return null;
};

export default function Home() {
  const [sessionId, setSessionId] = useState("");
  const [nickname, setNickname] = useState("");
  const [joinCode, setJoinCode] = useState("");

  const [createCategory, setCreateCategory] = useState("游戏");
  const [createUndercoverCount, setCreateUndercoverCount] = useState(1);
  const [createVoteEnabled, setCreateVoteEnabled] = useState(true);

  const [roomId, setRoomId] = useState<string | null>(null);
  const [room, setRoom] = useState<RoomRow | null>(null);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [votes, setVotes] = useState<VoteRow[]>([]);

  const [wordVisible, setWordVisible] = useState(false);
  const [voteTargetId, setVoteTargetId] = useState<string>("");

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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

  const loadRoomData = useCallback(
    async (targetRoomId: string) => {
      const roomRes = await supabase
        .from("rooms")
        .select("id, code, host_session_id, status, category, undercover_count, vote_enabled, round_number, vote_round, last_eliminated_player_id, result_summary")
        .eq("id", targetRoomId)
        .single();

      if (roomRes.error) {
        setError(roomRes.error.message);
        return;
      }

      const roomRow = roomRes.data as RoomRow;
      setRoom(roomRow);

      const playersRes = await supabase
        .from("players")
        .select("id, room_id, session_id, name, seat_no, is_undercover, is_alive, current_word")
        .eq("room_id", targetRoomId)
        .order("seat_no", { ascending: true });

      if (playersRes.error) {
        setError(playersRes.error.message);
        return;
      }

      const playerRows = (playersRes.data ?? []) as PlayerRow[];
      setPlayers(playerRows);

      if (roomRow.status === "voting") {
        const votesRes = await supabase
          .from("votes")
          .select("id, room_id, round_number, vote_round, voter_player_id, target_player_id")
          .eq("room_id", targetRoomId)
          .eq("round_number", roomRow.round_number)
          .eq("vote_round", roomRow.vote_round);

        if (!votesRes.error) {
          setVotes((votesRes.data ?? []) as VoteRow[]);
        }
      } else {
        setVotes([]);
      }
    },
    [],
  );

  useEffect(() => {
    if (!roomId) return;

    void loadRoomData(roomId);

    const channel: RealtimeChannel = supabase
      .channel(`room-${roomId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rooms", filter: `id=eq.${roomId}` },
        () => void loadRoomData(roomId),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "players", filter: `room_id=eq.${roomId}` },
        () => void loadRoomData(roomId),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "votes", filter: `room_id=eq.${roomId}` },
        () => void loadRoomData(roomId),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [roomId, loadRoomData]);

  const currentPlayer = useMemo(() => {
    return players.find((player) => player.session_id === sessionId) ?? null;
  }, [players, sessionId]);

  const isHost = useMemo(() => {
    return room?.host_session_id === sessionId;
  }, [room, sessionId]);

  const alivePlayers = useMemo(() => {
    return players.filter((player) => player.is_alive);
  }, [players]);

  const voteStats = useMemo(() => {
    const countMap = new Map<string, number>();
    for (const vote of votes) {
      countMap.set(vote.target_player_id, (countMap.get(vote.target_player_id) ?? 0) + 1);
    }
    return countMap;
  }, [votes]);

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
      let createdRoom: RoomRow | null = null;

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
          })
          .select("id, code, host_session_id, status, category, undercover_count, vote_enabled, round_number, vote_round, last_eliminated_player_id, result_summary")
          .single();

        if (roomInsert.error) {
          if (roomInsert.error.code === "23505") continue;
          throw new Error(roomInsert.error.message);
        }

        createdRoom = roomInsert.data as RoomRow;
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

      setRoomId(createdRoom.id);
      setJoinCode(createdRoom.code);
      setMessage(`房间创建成功，邀请码：${createdRoom.code}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建房间失败");
    } finally {
      setBusy(false);
    }
  };

  const joinRoom = async () => {
    if (!sessionId) return;
    if (!nickname.trim()) {
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
      const roomRes = await supabase
        .from("rooms")
        .select("id, code")
        .eq("code", code)
        .single();

      if (roomRes.error || !roomRes.data) {
        throw new Error("房间不存在，请检查邀请码。");
      }

      const targetRoomId = roomRes.data.id as string;

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
          name: nickname.trim(),
          seat_no: nextSeatNo,
          is_undercover: false,
          is_alive: true,
        });

        if (insert.error) {
          throw new Error(insert.error.message);
        }
      }

      setRoomId(targetRoomId);
      setJoinCode(code);
      setMessage("加入房间成功。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "加入房间失败");
    } finally {
      setBusy(false);
    }
  };

  const startRound = async () => {
    if (!room || !isHost) return;
    if (players.length < 3) {
      setError("至少 3 人才能开局。");
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/grok/words", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: room.category }),
      });

      const data = (await response.json()) as { pair?: WordPair; error?: string };
      if (!response.ok || !data.pair) {
        throw new Error(data.error ?? "AI 词条生成失败");
      }

      const currentUndercoverCount = clamp(room.undercover_count, 1, Math.max(players.length - 1, 1));
      const undercoverIds = pickUndercoverIds(players, currentUndercoverCount);

      const resetPlayers = await supabase
        .from("players")
        .update({
          is_undercover: false,
          is_alive: true,
          current_word: data.pair.civilian,
        })
        .eq("room_id", room.id);

      if (resetPlayers.error) {
        throw new Error(resetPlayers.error.message);
      }

      const setUndercover = await supabase
        .from("players")
        .update({
          is_undercover: true,
          current_word: data.pair.undercover,
        })
        .in("id", undercoverIds);

      if (setUndercover.error) {
        throw new Error(setUndercover.error.message);
      }

      const roomUpdate = await supabase
        .from("rooms")
        .update({
          status: "playing",
          round_number: room.round_number + 1,
          vote_round: 1,
          last_eliminated_player_id: null,
          result_summary: "本局已开始，系统已为每位玩家发词。",
        })
        .eq("id", room.id);

      if (roomUpdate.error) {
        throw new Error(roomUpdate.error.message);
      }

      setWordVisible(false);
      setVoteTargetId("");
      setMessage("本局已开，AI 仅生成 1 组词并已发词。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "开局失败");
    } finally {
      setBusy(false);
    }
  };

  const openVoting = async () => {
    if (!room || !isHost) return;
    setBusy(true);
    setError("");

    const update = await supabase
      .from("rooms")
      .update({ status: "voting", result_summary: `第 ${room.vote_round} 轮投票进行中` })
      .eq("id", room.id);

    if (update.error) {
      setError(update.error.message);
    } else {
      setMessage(`已开启第 ${room.vote_round} 轮投票。`);
    }

    setBusy(false);
  };

  const castVote = async () => {
    if (!room || !currentPlayer || !voteTargetId) {
      setError("请选择投票目标。");
      return;
    }

    if (currentPlayer.id === voteTargetId) {
      setError("不能投自己。");
      return;
    }

    setBusy(true);
    setError("");

    const upsertRes = await supabase.from("votes").upsert(
      {
        room_id: room.id,
        round_number: room.round_number,
        vote_round: room.vote_round,
        voter_player_id: currentPlayer.id,
        target_player_id: voteTargetId,
      },
      { onConflict: "room_id,round_number,vote_round,voter_player_id" },
    );

    if (upsertRes.error) {
      setError(upsertRes.error.message);
    } else {
      setMessage("投票成功，已记录。重复投票会覆盖你上一票。");
    }

    setBusy(false);
  };

  const publishVotingResult = async () => {
    if (!room || !isHost) return;

    setBusy(true);
    setError("");

    try {
      const votesRes = await supabase
        .from("votes")
        .select("id, room_id, round_number, vote_round, voter_player_id, target_player_id")
        .eq("room_id", room.id)
        .eq("round_number", room.round_number)
        .eq("vote_round", room.vote_round);

      if (votesRes.error) {
        throw new Error(votesRes.error.message);
      }

      const currentVotes = (votesRes.data ?? []) as VoteRow[];
      if (currentVotes.length === 0) {
        throw new Error("当前没有投票数据，无法公布结果。");
      }

      const counter = new Map<string, number>();
      for (const vote of currentVotes) {
        counter.set(vote.target_player_id, (counter.get(vote.target_player_id) ?? 0) + 1);
      }

      const maxVote = Math.max(...counter.values());
      const candidates = Array.from(counter.entries())
        .filter(([, value]) => value === maxVote)
        .map(([key]) => key);

      const eliminatedId = candidates[Math.floor(Math.random() * candidates.length)];
      const eliminatedPlayer = players.find((player) => player.id === eliminatedId);
      if (!eliminatedPlayer) {
        throw new Error("无法定位被淘汰玩家。");
      }

      const eliminateRes = await supabase
        .from("players")
        .update({ is_alive: false })
        .eq("id", eliminatedId);

      if (eliminateRes.error) {
        throw new Error(eliminateRes.error.message);
      }

      const nextPlayers = players.map((player) =>
        player.id === eliminatedId ? { ...player, is_alive: false } : player,
      );

      const winner = detectWinner(nextPlayers);
      const summary = `第 ${room.vote_round} 轮：玩家 ${eliminatedPlayer.seat_no}（${eliminatedPlayer.name}）出局。`;

      if (winner) {
        const finishRes = await supabase
          .from("rooms")
          .update({
            status: "finished",
            last_eliminated_player_id: eliminatedId,
            result_summary: `${summary} 最终胜方：${winner}阵营。`,
          })
          .eq("id", room.id);

        if (finishRes.error) {
          throw new Error(finishRes.error.message);
        }

        setMessage(`已公布结果：${summary} ${winner}阵营获胜。`);
      } else {
        const continueRes = await supabase
          .from("rooms")
          .update({
            status: "playing",
            vote_round: room.vote_round + 1,
            last_eliminated_player_id: eliminatedId,
            result_summary: `${summary} 请继续讨论，准备下一轮投票。`,
          })
          .eq("id", room.id);

        if (continueRes.error) {
          throw new Error(continueRes.error.message);
        }

        setMessage(`已公布结果：${summary}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "公布失败");
    } finally {
      setBusy(false);
    }
  };

  const leaveRoom = () => {
    setRoomId(null);
    setRoom(null);
    setPlayers([]);
    setVotes([]);
    setWordVisible(false);
    setVoteTargetId("");
    setMessage("已退出房间。");
    setError("");
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

        {!roomId && (
          <section className="panel-grid entry-grid">
            <article className="panel">
              <h2>创建房间</h2>
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
                <input
                  type="text"
                  value={createCategory}
                  onChange={(event) => setCreateCategory(event.target.value)}
                  placeholder="例如：游戏"
                />
              </label>
              <label>
                卧底人数（开局时随机分配）
                <input
                  type="number"
                  min={1}
                  max={3}
                  value={createUndercoverCount}
                  onChange={(event) =>
                    setCreateUndercoverCount(clamp(Number(event.target.value) || 1, 1, 3))
                  }
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

            <article className="panel">
              <h2>加入房间</h2>
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
              <button type="button" className="btn" onClick={joinRoom} disabled={busy}>
                {busy ? "处理中..." : "加入房间"}
              </button>
            </article>
          </section>
        )}

        {roomId && room && (
          <section className="panel-grid room-grid">
            <article className="panel">
              <h2>房间信息</h2>
              <div className="status-row">
                <span className="status-pill">邀请码：{room.code}</span>
                <span className="status-pill">状态：{room.status}</span>
                <span className="status-pill">类别：{room.category}</span>
              </div>
              <p className="hint">局数：{room.round_number} · 投票轮次：{room.vote_round}</p>
              <p className="hint">投票功能：{room.vote_enabled ? "开启" : "关闭"}</p>

              {currentPlayer && (
                <div className="word-card self-word-card">
                  <span className="tag">你的身份词</span>
                  {room.status === "lobby" ? (
                    <strong>等待房主开局</strong>
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
                <button type="button" className="btn ghost" onClick={leaveRoom}>
                  退出房间
                </button>
              </div>

              {isHost && (
                <div className="host-actions">
                  <h3>房主操作</h3>
                  <div className="actions-row">
                    <button
                      type="button"
                      className="btn primary"
                      onClick={startRound}
                      disabled={busy || room.status === "voting"}
                    >
                      {room.round_number === 0 ? "开始本局（AI 生成 1 组词）" : "重开新局（重新生成 1 组词）"}
                    </button>
                    {room.vote_enabled && room.status === "playing" && (
                      <button type="button" className="btn" onClick={openVoting} disabled={busy}>
                        开启第 {room.vote_round} 轮投票
                      </button>
                    )}
                    {room.vote_enabled && room.status === "voting" && (
                      <button
                        type="button"
                        className="btn primary"
                        onClick={publishVotingResult}
                        disabled={busy}
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
              <ul className="player-list">
                {players.map((player) => (
                  <li key={player.id} className={!player.is_alive ? "out" : ""}>
                    <span>
                      #{player.seat_no} {player.name} {player.session_id === sessionId ? "(你)" : ""}
                    </span>
                    <strong>{player.is_alive ? "存活" : "出局"}</strong>
                  </li>
                ))}
              </ul>

              {room.vote_enabled && room.status === "voting" && currentPlayer?.is_alive && (
                <div className="vote-box">
                  <h3>本轮投票</h3>
                  <label>
                    选择你怀疑的卧底
                    <select
                      value={voteTargetId}
                      onChange={(event) => setVoteTargetId(event.target.value)}
                    >
                      <option value="">请选择玩家</option>
                      {alivePlayers
                        .filter((player) => player.id !== currentPlayer.id)
                        .map((player) => (
                          <option key={player.id} value={player.id}>
                            玩家 {player.seat_no} · {player.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <button type="button" className="btn primary" onClick={castVote} disabled={busy}>
                    提交/更新我的投票
                  </button>

                  <p className="hint">
                    已投票人数：{new Set(votes.map((vote) => vote.voter_player_id)).size}/{alivePlayers.length}
                  </p>

                  {votes.length > 0 && (
                    <ul className="vote-stats">
                      {alivePlayers.map((player) => (
                        <li key={player.id}>
                          玩家 {player.seat_no}（{player.name}）：{voteStats.get(player.id) ?? 0} 票
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {room.result_summary && <p className="hint room-summary">{room.result_summary}</p>}
            </article>
          </section>
        )}

        {error && <p className="notice error">{error}</p>}
        {message && <p className="notice success">{message}</p>}
      </main>
    </div>
  );
}
