"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { pinyin } from "pinyin-pro";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  vote_duration_seconds: number;
  vote_started_at: string | null;
  vote_deadline_at: string | null;
  vote_candidate_ids: string[] | null;
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
  target_player_id: string | null;
};

type WordPair = {
  civilian: string;
  undercover: string;
};

type WordHistoryRow = {
  pair_key: string;
  civilian: string;
  undercover: string;
};

type Category = {
  id: string;
  name: string;
  display_name: string;
  sort_order: number;
  category_subcategories?: Subcategory[];
};

type Subcategory = {
  id: string;
  name: string;
  display_name: string;
  examples: { examples: string[] };
  sort_order: number;
};

type CategoryUsageRow = {
  category: string;
};

type CategorySuggestion = {
  key: string;
  categoryId: string;
  categoryDisplayName: string;
  subcategoryDisplayName: string;
  examples: string[];
  categorySort: number;
  subcategorySort: number;
  usageCount: number;
  categoryInitials: string;
  subcategoryInitials: string;
  isRandomOption?: boolean;
};

const SESSION_KEY = "undercover.session.id";
const ALL_CATEGORY_RANDOM = "全部分类（系统随机）";
const ABSTAIN_VOTE_VALUE = "__ABSTAIN__";

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

const undercoverKey = (ids: string[]) => {
  return [...ids].sort().join("|");
};

const pickUndercoverIds = (
  players: PlayerRow[],
  undercoverCount: number,
  previousKey?: string,
) => {
  const pool = [...players.map((player) => player.id)];
  if (undercoverCount >= pool.length) {
    return pool;
  }

  let fallback = pool.slice(0, undercoverCount);

  // Retry several times to avoid repeating the exact same undercover set as last round.
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

const normalizePairKey = (pair: WordPair) => {
  const left = pair.civilian.trim().toLowerCase();
  const right = pair.undercover.trim().toLowerCase();
  return [left, right].sort().join("||");
};

const normalizeSearchText = (value: string) => value.toLowerCase().replace(/\s+/g, "");

const subsequenceMatch = (target: string, query: string) => {
  if (!query) return true;
  let qi = 0;
  for (let i = 0; i < target.length && qi < query.length; i += 1) {
    if (target[i] === query[qi]) qi += 1;
  }
  return qi === query.length;
};

const toPinyinInitials = (value: string) => {
  try {
    return pinyin(value, {
      pattern: "first",
      toneType: "none",
      type: "array",
      nonZh: "consecutive",
    })
      .join("")
      .toLowerCase()
      .replace(/\s+/g, "");
  } catch {
    return "";
  }
};

export default function Home() {
  const [sessionId, setSessionId] = useState("");
  const [nickname, setNickname] = useState("");
  const [joinCode, setJoinCode] = useState("");

  const [createCategory, setCreateCategory] = useState("游戏");
  const [createUndercoverCount, setCreateUndercoverCount] = useState(1);
  const [createVoteEnabled, setCreateVoteEnabled] = useState(true);
  const [createVoteDurationSeconds, setCreateVoteDurationSeconds] = useState(60);

  const [categories, setCategories] = useState<Category[]>([]);
  const [categorySearchOpen, setCategorySearchOpen] = useState(false);
  const [categorySearchQuery, setCategorySearchQuery] = useState("");
  const [roomCategorySearchOpen, setRoomCategorySearchOpen] = useState(false);
  const [roomCategorySearchQuery, setRoomCategorySearchQuery] = useState("");
  const [categoryUsageMap, setCategoryUsageMap] = useState<Record<string, number>>({});

  const [roomId, setRoomId] = useState<string | null>(null);
  const [room, setRoom] = useState<RoomRow | null>(null);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [votes, setVotes] = useState<VoteRow[]>([]);

  const [wordVisible, setWordVisible] = useState(false);
  const [voteTargetId, setVoteTargetId] = useState<string>("");
  const [editableCategory, setEditableCategory] = useState("");
  const [editableVoteDurationSeconds, setEditableVoteDurationSeconds] = useState(60);
  const [nowMs, setNowMs] = useState(Date.now());

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const autoPublishingRef = useRef(false);

  useEffect(() => {
    if (room) {
      setEditableCategory(room.category);
      setRoomCategorySearchQuery(room.category);
      setEditableVoteDurationSeconds(room.vote_duration_seconds ?? 60);
    }
  }, [room]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

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

  useEffect(() => {
    const fetchCategories = async () => {
      try {
        const res = await fetch("/api/categories");
        if (!res.ok) throw new Error("Failed to fetch categories");
        const data = await res.json();
        setCategories(data.categories || []);
        // 默认选择第一个主类别
        if (data.categories && data.categories.length > 0) {
          const firstCategory = data.categories[0];
          // 默认选择第一个子类别作为初始类别
          if (firstCategory.category_subcategories && firstCategory.category_subcategories.length > 0) {
            setCreateCategory(firstCategory.category_subcategories[0].display_name);
            setCategorySearchQuery(firstCategory.category_subcategories[0].display_name);
          }
        }
      } catch (err) {
        console.error("Failed to fetch categories:", err);
      }
    };
    fetchCategories();
  }, []);

  useEffect(() => {
    const fetchCategoryUsage = async () => {
      const [roomsRes, historyRes] = await Promise.all([
        supabase.from("rooms").select("category"),
        supabase.from("room_word_history").select("category"),
      ]);

      const usage: Record<string, number> = {};
      const rows = [
        ...((roomsRes.data ?? []) as CategoryUsageRow[]),
        ...((historyRes.data ?? []) as CategoryUsageRow[]),
      ];

      rows.forEach((row) => {
        const key = row.category?.trim();
        if (!key) return;
        usage[key] = (usage[key] ?? 0) + 1;
      });

      setCategoryUsageMap(usage);
    };

    void fetchCategoryUsage();
  }, []);

  const allCategorySuggestions = useMemo(() => {
    return categories.flatMap((category) =>
      (category.category_subcategories ?? []).map((subcategory) => ({
        key: `${category.id}-${subcategory.id}`,
        categoryId: category.id,
        categoryDisplayName: category.display_name,
        subcategoryDisplayName: subcategory.display_name,
        examples: subcategory.examples?.examples ?? [],
        categorySort: category.sort_order,
        subcategorySort: subcategory.sort_order,
        usageCount: categoryUsageMap[subcategory.display_name] ?? 0,
        categoryInitials: toPinyinInitials(category.display_name),
        subcategoryInitials: toPinyinInitials(subcategory.display_name),
      })),
    );
  }, [categories, categoryUsageMap]);

  const buildCategorySuggestions = useCallback(
    (rawQuery: string, emptyLimit = 10) => {
      const query = rawQuery.trim().toLowerCase();
      const q = normalizeSearchText(query);
      const randomInitials = toPinyinInitials(ALL_CATEGORY_RANDOM);
      const randomOption: CategorySuggestion = {
        key: "all-random",
        categoryId: "",
        categoryDisplayName: "随机模式",
        subcategoryDisplayName: ALL_CATEGORY_RANDOM,
        examples: ["每局随机", "无需手动选择"],
        categorySort: -1,
        subcategorySort: -1,
        usageCount: 0,
        categoryInitials: "sj",
        subcategoryInitials: randomInitials,
        isRandomOption: true,
      };

      const randomMatches =
        !q ||
        randomOption.subcategoryDisplayName.includes(query) ||
        randomOption.subcategoryInitials.includes(q) ||
        "allrandomsuijiquanbu".includes(q);

      if (!query) {
        const top = [...allCategorySuggestions]
          .sort((a, b) => {
            if (b.usageCount !== a.usageCount) return b.usageCount - a.usageCount;
            if (a.categorySort !== b.categorySort) return a.categorySort - b.categorySort;
            return a.subcategorySort - b.subcategorySort;
          })
          .slice(0, Math.max(emptyLimit - 1, 0));

        return [randomOption, ...top];
      }

      const matches = allCategorySuggestions
        .map((item) => {
          const categoryName = normalizeSearchText(item.categoryDisplayName);
          const subcategoryName = normalizeSearchText(item.subcategoryDisplayName);
          const exampleText = normalizeSearchText(item.examples.join(" "));
          const categoryInitials = item.categoryInitials;
          const subcategoryInitials = item.subcategoryInitials;

          let score = 0;
          if (subcategoryName.startsWith(q)) score += 6;
          if (subcategoryName.includes(q)) score += 5;
          if (categoryName.includes(q)) score += 4;
          if (subcategoryInitials.startsWith(q)) score += 4;
          if (subcategoryInitials.includes(q)) score += 3;
          if (categoryInitials.startsWith(q)) score += 3;
          if (categoryInitials.includes(q)) score += 2;
          if (exampleText.includes(q)) score += 2;
          if (subsequenceMatch(subcategoryName, q)) score += 1;
          if (subsequenceMatch(subcategoryInitials, q)) score += 1;

          return { item, score };
        })
        .filter(({ score }) => score > 0)
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          if (b.item.usageCount !== a.item.usageCount) return b.item.usageCount - a.item.usageCount;
          if (a.item.categorySort !== b.item.categorySort) return a.item.categorySort - b.item.categorySort;
          return a.item.subcategorySort - b.item.subcategorySort;
        })
        .map(({ item }) => item)
        .slice(0, 20);

      if (!randomMatches) return matches;
      return [randomOption, ...matches];
    },
    [allCategorySuggestions],
  );

  const categorySuggestions = useMemo(
    () => buildCategorySuggestions(categorySearchQuery),
    [buildCategorySuggestions, categorySearchQuery],
  );

  const roomCategorySuggestions = useMemo(
    () => buildCategorySuggestions(roomCategorySearchQuery),
    [buildCategorySuggestions, roomCategorySearchQuery],
  );

  const loadRoomData = useCallback(
    async (targetRoomId: string) => {
      const roomRes = await supabase
        .from("rooms")
        .select("id, code, host_session_id, status, category, undercover_count, vote_enabled, round_number, vote_round, vote_duration_seconds, vote_started_at, vote_deadline_at, vote_candidate_ids, last_eliminated_player_id, result_summary")
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

  const voteScopePlayers = useMemo(() => {
    if (!room?.vote_candidate_ids || room.vote_candidate_ids.length === 0) {
      return alivePlayers;
    }

    const scope = new Set(room.vote_candidate_ids);
    return alivePlayers.filter((player) => scope.has(player.id));
  }, [alivePlayers, room?.vote_candidate_ids]);

  const eligibleVoters = useMemo(() => {
    if (!room?.vote_candidate_ids || room.vote_candidate_ids.length === 0) {
      return alivePlayers;
    }

    const candidateSet = new Set(room.vote_candidate_ids);
    return alivePlayers.filter((player) => !candidateSet.has(player.id));
  }, [alivePlayers, room?.vote_candidate_ids]);

  const voteDeadlineMs = useMemo(() => {
    if (!room?.vote_deadline_at) return null;
    const parsed = Date.parse(room.vote_deadline_at);
    return Number.isNaN(parsed) ? null : parsed;
  }, [room?.vote_deadline_at]);

  const remainingVoteSeconds = useMemo(() => {
    if (!voteDeadlineMs) return null;
    return Math.max(0, Math.ceil((voteDeadlineMs - nowMs) / 1000));
  }, [voteDeadlineMs, nowMs]);

  const votedCount = useMemo(() => {
    const eligibleSet = new Set(eligibleVoters.map((player) => player.id));
    return new Set(votes.filter((vote) => eligibleSet.has(vote.voter_player_id)).map((vote) => vote.voter_player_id)).size;
  }, [votes, eligibleVoters]);

  const canCurrentPlayerVote = useMemo(() => {
    if (!currentPlayer || !currentPlayer.is_alive) return false;
    return eligibleVoters.some((player) => player.id === currentPlayer.id);
  }, [currentPlayer, eligibleVoters]);

  const tieCandidatePlayers = useMemo(() => {
    if (!room?.vote_candidate_ids || room.vote_candidate_ids.length === 0) return [] as PlayerRow[];
    const set = new Set(room.vote_candidate_ids);
    return alivePlayers.filter((player) => set.has(player.id));
  }, [room?.vote_candidate_ids, alivePlayers]);

  const rotatedPlayers = useMemo(() => {
    if (players.length <= 1) return players;
    const sorted = [...players].sort((a, b) => a.seat_no - b.seat_no);
    const rotation = room ? Math.max(room.round_number - 1, 0) % sorted.length : 0;
    return [...sorted.slice(rotation), ...sorted.slice(0, rotation)];
  }, [players, room]);

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
            vote_duration_seconds: clamp(createVoteDurationSeconds, 15, 600),
            vote_started_at: null,
            vote_deadline_at: null,
            vote_candidate_ids: null,
          })
          .select("id, code, host_session_id, status, category, undercover_count, vote_enabled, round_number, vote_round, vote_duration_seconds, vote_started_at, vote_deadline_at, vote_candidate_ids, last_eliminated_player_id, result_summary")
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
      const categoryPool = categories.flatMap((category) =>
        (category.category_subcategories ?? []).map((subcategory) => subcategory.display_name),
      );

      const isRandomAllMode = room.category === ALL_CATEGORY_RANDOM;
      const pickedCategory = isRandomAllMode
        ? categoryPool[secureRandomInt(Math.max(categoryPool.length, 1))]
        : room.category;

      if (!pickedCategory) {
        throw new Error("随机类别池为空，请先初始化分类库。");
      }

      const historyRes = await supabase
        .from("room_word_history")
        .select("pair_key, civilian, undercover")
        .eq("room_id", room.id)
        .eq("category", pickedCategory);

      if (historyRes.error) {
        throw new Error(historyRes.error.message);
      }

      const historyRows = (historyRes.data ?? []) as WordHistoryRow[];
      const usedKeys = new Set(historyRows.map((row) => row.pair_key));
      const excludedPairs = historyRows.map((row) => `${row.civilian}/${row.undercover}`);

      let acceptedPair: WordPair | null = null;

      for (let attempt = 0; attempt < 6; attempt += 1) {
        const response = await fetch("/api/grok/words", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            category: pickedCategory,
            excludedPairs,
          }),
        });

        const data = (await response.json()) as { pair?: WordPair; error?: string };
        if (!response.ok || !data.pair) {
          throw new Error(data.error ?? "AI 词条生成失败");
        }

        const pairKey = normalizePairKey(data.pair);
        if (usedKeys.has(pairKey)) {
          continue;
        }

        const insertHistory = await supabase.from("room_word_history").insert({
          room_id: room.id,
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

      const currentUndercoverCount = clamp(room.undercover_count, 1, Math.max(players.length - 1, 1));
      const previousUndercover = players
        .filter((player) => player.is_undercover)
        .map((player) => player.id);
      const previousKey = room.round_number > 0 ? undercoverKey(previousUndercover) : undefined;
      const undercoverIds = pickUndercoverIds(players, currentUndercoverCount, previousKey);

      const resetPlayers = await supabase
        .from("players")
        .update({
          is_undercover: false,
          is_alive: true,
          current_word: acceptedPair.civilian,
        })
        .eq("room_id", room.id);

      if (resetPlayers.error) {
        throw new Error(resetPlayers.error.message);
      }

      const setUndercover = await supabase
        .from("players")
        .update({
          is_undercover: true,
          current_word: acceptedPair.undercover,
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
          vote_started_at: null,
          vote_deadline_at: null,
          vote_candidate_ids: null,
          last_eliminated_player_id: null,
          result_summary: "本局已开始，系统已为每位玩家发词。",
        })
        .eq("id", room.id);

      if (roomUpdate.error) {
        throw new Error(roomUpdate.error.message);
      }

      setWordVisible(false);
      setVoteTargetId("");
      setMessage(
        isRandomAllMode
          ? `本局已开，系统随机类别：${pickedCategory}。AI 已生成 1 组词并发词。`
          : "本局已开，AI 仅生成 1 组词并已发词。",
      );

      if (isRandomAllMode) {
        const updateSummary = await supabase
          .from("rooms")
          .update({ result_summary: `本局已开始（随机类别：${pickedCategory}），系统已为每位玩家发词。` })
          .eq("id", room.id);
        if (updateSummary.error) {
          throw new Error(updateSummary.error.message);
        }
      }
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
      .eq("id", room.id);

    if (update.error) {
      setError(update.error.message);
    } else {
      setMessage(`已开启第 ${room.vote_round} 轮投票。`);
    }

    setBusy(false);
  };

  const castVote = async () => {
    if (!room || !currentPlayer) {
      setError("请选择投票目标。");
      return;
    }

    if (!canCurrentPlayerVote) {
      setError("当前加赛轮次中，平票玩家不能投票。请等待其他存活玩家投票。");
      return;
    }

    const isAbstainVote = voteTargetId === ABSTAIN_VOTE_VALUE;
    if (!isAbstainVote && !voteTargetId) {
      setError("请选择投票目标或选择弃票。");
      return;
    }

    if (!isAbstainVote && currentPlayer.id === voteTargetId) {
      setError("不能投自己。");
      return;
    }

    const scopeIds = new Set(voteScopePlayers.map((player) => player.id));
    if (!isAbstainVote && !scopeIds.has(voteTargetId)) {
      setError("当前轮次只能投指定候选人。请刷新后重试。");
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
        target_player_id: isAbstainVote ? null : voteTargetId,
      },
      { onConflict: "room_id,round_number,vote_round,voter_player_id" },
    );

    if (upsertRes.error) {
      setError(upsertRes.error.message);
    } else {
      setMessage(
        isAbstainVote
          ? "你已选择弃票，系统已记录。重复投票会覆盖你上一票。"
          : "投票成功，已记录。重复投票会覆盖你上一票。",
      );
    }

    setBusy(false);
  };

  const publishVotingResult = useCallback(async () => {
    if (!room) return;

    setBusy(true);
    setError("");

    try {
      const response = await fetch(`/api/rooms/${room.id}/settle-vote`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
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

      if (result.action === "revote-no-votes") {
        setMessage("本轮无人有效投票（可能全员弃票），已进入讨论阶段，请房主开启下一轮投票。");
        return;
      }

      if (result.action === "revote-no-votes-pending") {
        setMessage("本轮无人有效投票（可能全员弃票），请继续描述，由房主开启下一轮投票。");
        return;
      }

      if (result.action === "revote-tie") {
        setMessage("本轮出现平票，已进入讨论阶段，请房主开启加赛投票。");
        return;
      }

      if (result.action === "revote-tie-pending") {
        setMessage("本轮出现平票，请继续描述，由房主开启加赛投票。");
        return;
      }

      if (result.action === "noop" && result.reason === "waiting-for-deadline-or-all-votes") {
        setMessage("尚未到投票截止且未全员投票，暂不结算。");
        return;
      }

      if (result.action === "finished") {
        setMessage("投票已自动结算，游戏已结束。");
        return;
      }

      if (result.action === "eliminated") {
        setMessage("投票已自动结算，已淘汰一名玩家。");
        return;
      }

      if (result.action === "noop" && result.reason === "stale-client") {
        return;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "公布失败");
    } finally {
      setBusy(false);
    }
  }, [room]);

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

  useEffect(() => {
    if (!roomId || !room) return;
    if (players.length === 0) return;

    const stillInRoom = players.some((player) => player.session_id === sessionId);
    if (stillInRoom) return;

    // If current session is no longer in player list, this user has been removed.
    setRoomId(null);
    setRoom(null);
    setPlayers([]);
    setVotes([]);
    setWordVisible(false);
    setVoteTargetId("");
    setError("");
    setMessage("你已被房主移出房间。");
  }, [roomId, room, players, sessionId]);

  const updateRoomCategory = async () => {
    if (!room || !isHost) return;

    const nextCategory = editableCategory.trim();
    if (!nextCategory) {
      setError("类别不能为空。");
      return;
    }

    setBusy(true);
    setError("");

    const update = await supabase
      .from("rooms")
      .update({ category: nextCategory })
      .eq("id", room.id);

    if (update.error) {
      setError(update.error.message);
    } else {
      setMessage(`类别已更新为：${nextCategory}`);
    }

    setBusy(false);
  };

  const updateVoteDuration = async () => {
    if (!room || !isHost) return;

    const nextDuration = clamp(editableVoteDurationSeconds, 15, 600);
    setBusy(true);
    setError("");

    const update = await supabase
      .from("rooms")
      .update({ vote_duration_seconds: nextDuration })
      .eq("id", room.id);

    if (update.error) {
      setError(update.error.message);
    } else {
      setMessage(`投票时长已更新为 ${nextDuration} 秒。`);
    }

    setBusy(false);
  };

  useEffect(() => {
    if (!room || room.status !== "voting" || autoPublishingRef.current) return;

    const voterCount = eligibleVoters.length;
    const allVoted = voterCount > 0 && votedCount >= voterCount;
    const deadlineReached = !!voteDeadlineMs && nowMs >= voteDeadlineMs;

    if (!allVoted && !deadlineReached) return;

    autoPublishingRef.current = true;
    void publishVotingResult().finally(() => {
      autoPublishingRef.current = false;
    });
  }, [room, eligibleVoters.length, votedCount, voteDeadlineMs, nowMs, publishVotingResult]);

  const kickPlayer = async (targetPlayer: PlayerRow) => {
    if (!room || !isHost) return;
    if (targetPlayer.session_id === sessionId) {
      setError("不能踢出自己。");
      return;
    }

    setBusy(true);
    setError("");

    try {
      const remove = await supabase.from("players").delete().eq("id", targetPlayer.id);
      if (remove.error) {
        throw new Error(remove.error.message);
      }

      if (room.status !== "lobby") {
        const nextPlayers = players.filter((player) => player.id !== targetPlayer.id);
        const winner = detectWinner(nextPlayers);

        if (winner) {
          const finish = await supabase
            .from("rooms")
            .update({
              status: "finished",
              result_summary: `玩家 ${targetPlayer.seat_no}（${targetPlayer.name}）被移出。最终胜方：${winner}阵营。`,
            })
            .eq("id", room.id);

          if (finish.error) {
            throw new Error(finish.error.message);
          }
        } else {
          const roomUpdate = await supabase
            .from("rooms")
            .update({
              result_summary: `玩家 ${targetPlayer.seat_no}（${targetPlayer.name}）被房主移出。`,
            })
            .eq("id", room.id);

          if (roomUpdate.error) {
            throw new Error(roomUpdate.error.message);
          }
        }
      }

      setMessage(`已将玩家 ${targetPlayer.seat_no}（${targetPlayer.name}）移出房间。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "踢人失败");
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
                              backgroundColor:
                                createCategory === item.subcategoryDisplayName ? "#e8f4f8" : "#fff",
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
                  onChange={(event) =>
                    setCreateUndercoverCount(clamp(Number(event.target.value) || 1, 1, 3))
                  }
                />
              </label>
              <label>
                每轮投票限时（秒）
                <input
                  type="number"
                  min={15}
                  max={600}
                  value={createVoteDurationSeconds}
                  onChange={(event) =>
                    setCreateVoteDurationSeconds(clamp(Number(event.target.value) || 15, 15, 600))
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
                      value={roomCategorySearchQuery}
                      onChange={(event) => {
                        setRoomCategorySearchQuery(event.target.value);
                        setEditableCategory(event.target.value.trim() || editableCategory);
                      }}
                      onFocus={() => setRoomCategorySearchOpen(true)}
                      placeholder="搜索并修改房间类别"
                    />
                    <button type="button" className="btn ghost" onClick={updateRoomCategory} disabled={busy}>
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
                        {roomCategorySearchQuery.trim() ? "模糊匹配结果" : "Top10 热门种类词"}
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
                            backgroundColor:
                              editableCategory === item.subcategoryDisplayName ? "#e8f4f8" : "#fff",
                            cursor: "pointer",
                          }}
                          onClick={() => {
                            setEditableCategory(item.subcategoryDisplayName);
                            setRoomCategorySearchQuery(item.subcategoryDisplayName);
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

                      {roomCategorySearchQuery.trim() && (
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
                            const custom = roomCategorySearchQuery.trim();
                            setEditableCategory(custom);
                            setRoomCategorySearchOpen(false);
                          }}
                        >
                          使用“{roomCategorySearchQuery.trim()}”作为自定义类别
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {isHost && (
                <div className="inline-row room-category-editor">
                  <input
                    type="number"
                    min={15}
                    max={600}
                    value={editableVoteDurationSeconds}
                    onChange={(event) =>
                      setEditableVoteDurationSeconds(clamp(Number(event.target.value) || 15, 15, 600))
                    }
                    placeholder="投票时长（秒）"
                  />
                  <button type="button" className="btn ghost" onClick={updateVoteDuration} disabled={busy}>
                    保存投票时长
                  </button>
                </div>
              )}

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
                        {room.vote_candidate_ids && room.vote_candidate_ids.length > 0
                          ? `开启第 ${room.vote_round} 轮加赛投票`
                          : `开启第 ${room.vote_round} 轮投票`}
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
              <p className="hint">当前发言顺序（每局自动轮换）：</p>
              <ul className="player-list">
                {rotatedPlayers.map((player, index) => (
                  <li key={player.id} className={!player.is_alive ? "out" : ""}>
                    <span className="player-main">
                      第{index + 1}位 ·
                      #{player.seat_no} {player.name} {player.session_id === sessionId ? "(你)" : ""}
                    </span>
                    <span className="player-side">
                      <strong>{player.is_alive ? "存活" : "出局"}</strong>
                      {isHost && player.session_id !== sessionId && (
                        <button
                          type="button"
                          className="btn danger tiny"
                          onClick={() => void kickPlayer(player)}
                          disabled={busy}
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
                        ? ` ${tieCandidatePlayers.map((player) => `#${player.seat_no} ${player.name}`).join("、")}`
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
                    <select
                      value={voteTargetId}
                      onChange={(event) => setVoteTargetId(event.target.value)}
                      disabled={!canCurrentPlayerVote}
                    >
                      <option value="">请选择玩家</option>
                      <option value={ABSTAIN_VOTE_VALUE}>弃票（不投任何人）</option>
                      {voteScopePlayers
                        .filter((player) => player.id !== currentPlayer.id)
                        .map((player) => (
                          <option key={player.id} value={player.id}>
                            玩家 {player.seat_no} · {player.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="btn primary"
                    onClick={castVote}
                    disabled={busy || !canCurrentPlayerVote}
                  >
                    提交/更新我的投票
                  </button>
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
