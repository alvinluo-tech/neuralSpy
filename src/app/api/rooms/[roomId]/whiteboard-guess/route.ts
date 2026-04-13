import { NextRequest, NextResponse } from "next/server";
import {
  detectWinnerByRole,
  isWhiteboardRole,
  sanitizeRoomSummary,
  WHITEBOARD_GUESS_PENDING_MARKER,
} from "@/lib/gameEngine";
import { getSupabaseAdmin } from "@/lib/server/supabaseAdmin";

type JudgeProvider = "grok" | "gemini";

type RoomRow = {
  id: string;
  status: "lobby" | "playing" | "voting" | "finished";
  result_summary: string | null;
  last_eliminated_player_id: string | null;
};

type PlayerRow = {
  id: string;
  room_id: string;
  name: string;
  is_undercover: boolean;
  is_alive: boolean;
  current_word: string | null;
};

const parseBooleanFromModelContent = (content: string) => {
  const jsonCandidate = content.match(/\{[\s\S]*\}/)?.[0] ?? content;
  try {
    const parsed = JSON.parse(jsonCandidate) as {
      isSameMeaning?: boolean;
      confidence?: number;
      reason?: string;
    };
    return {
      isSameMeaning: parsed.isSameMeaning === true,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
      reason: parsed.reason ?? "",
    };
  } catch {
    return {
      isSameMeaning: false,
      confidence: 0,
      reason: "模型响应解析失败",
    };
  }
};

const judgeByGroq = async (targetWord: string, guessedWord: string) => {
  const apiKey = process.env.GROQ_API_KEY;
  const apiUrl = process.env.GROQ_API_URL ?? "https://api.groq.com/openai/v1/chat/completions";
  const model = process.env.GROQ_MODEL ?? "qwen/qwen3-32b";

  if (!apiKey) {
    throw new Error("缺少 GROQ_API_KEY，无法执行白板猜词判定。");
  }

  const prompt = [
    "你是语义判定器，任务是判断两个中文词是否表达同一事物或同义。",
    "判断标准：近义词、同指代、口语和正式说法可视为同义；泛化/并列概念视为不同义。",
    `词1：${targetWord}`,
    `词2：${guessedWord}`,
    '仅返回 JSON：{"isSameMeaning": true|false, "confidence": 0~1, "reason": "简短理由"}',
  ].join("\n");

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      stream: false,
      messages: [
        { role: "system", content: "你只输出可解析 JSON。" },
        { role: "user", content: prompt },
      ],
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Groq 判定失败（${response.status}）：${errorText.slice(0, 240)}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
  };

  const content = payload.choices?.[0]?.message?.content ?? "";
  return parseBooleanFromModelContent(content);
};

const judgeByGemini = async (targetWord: string, guessedWord: string) => {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL ?? "gemini-2.0-flash";

  if (!apiKey) {
    throw new Error("缺少 GEMINI_API_KEY，无法执行 Gemini 判定。");
  }

  const prompt = [
    "请判断两个中文词是否同义或同指代。",
    `词1：${targetWord}`,
    `词2：${guessedWord}`,
    '仅返回 JSON：{"isSameMeaning": true|false, "confidence": 0~1, "reason": "简短理由"}',
  ].join("\n");

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
        },
      }),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini 判定失败（${response.status}）：${errorText.slice(0, 240)}`);
  }

  const payload = (await response.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>;
      };
    }>;
  };

  const content = payload.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  return parseBooleanFromModelContent(content);
};

const semanticMatch = async (
  targetWord: string,
  guessedWord: string,
  provider: JudgeProvider,
) => {
  const normalizedTarget = targetWord.trim().toLowerCase();
  const normalizedGuess = guessedWord.trim().toLowerCase();

  if (!normalizedTarget || !normalizedGuess) {
    return { isSameMeaning: false, confidence: 0, reason: "空词" };
  }

  if (normalizedTarget === normalizedGuess) {
    return { isSameMeaning: true, confidence: 1, reason: "完全一致" };
  }

  if (provider === "gemini") {
    return judgeByGemini(targetWord, guessedWord);
  }

  return judgeByGroq(targetWord, guessedWord);
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> },
) {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { roomId } = await params;

    const body = (await request.json().catch(() => ({}))) as {
      playerId?: string;
      guess?: string;
      provider?: JudgeProvider;
    };

    const playerId = body.playerId?.trim();
    const guessedWord = body.guess?.trim();
    const provider: JudgeProvider = body.provider === "gemini" ? "gemini" : "grok";

    if (!playerId || !guessedWord) {
      return NextResponse.json({ error: "缺少 playerId 或 guess。" }, { status: 400 });
    }

    const roomRes = await supabaseAdmin
      .from("rooms")
      .select("id, status, result_summary, last_eliminated_player_id")
      .eq("id", roomId)
      .maybeSingle();

    if (roomRes.error) {
      return NextResponse.json({ error: roomRes.error.message }, { status: 500 });
    }

    const room = roomRes.data as RoomRow | null;
    if (!room) {
      return NextResponse.json({ error: "Room not found." }, { status: 404 });
    }

    const hasPendingGuess = (room.result_summary ?? "").includes(WHITEBOARD_GUESS_PENDING_MARKER);
    if (!hasPendingGuess || room.last_eliminated_player_id !== playerId || room.status !== "playing") {
      return NextResponse.json({ ok: true, action: "noop", reason: "not-pending" });
    }

    const playersRes = await supabaseAdmin
      .from("players")
      .select("id, room_id, name, is_undercover, is_alive, current_word")
      .eq("room_id", room.id);

    if (playersRes.error) {
      return NextResponse.json({ error: playersRes.error.message }, { status: 500 });
    }

    const players = (playersRes.data ?? []) as PlayerRow[];
    const currentPlayer = players.find((player) => player.id === playerId) ?? null;

    if (!currentPlayer) {
      return NextResponse.json({ error: "Player not found in this room." }, { status: 404 });
    }

    if (currentPlayer.is_alive || !isWhiteboardRole(currentPlayer)) {
      return NextResponse.json({ error: "仅已出局白板可以提交猜词。" }, { status: 400 });
    }

    const civilianWord =
      players.find((player) => !player.is_undercover && player.current_word !== null)?.current_word ?? null;

    if (!civilianWord) {
      return NextResponse.json({ error: "无法获取平民词。" }, { status: 500 });
    }

    const judged = await semanticMatch(civilianWord, guessedWord, provider);

    if (judged.isSameMeaning) {
      const summary = `${sanitizeRoomSummary(room.result_summary)} 白板玩家 ${currentPlayer.name} 猜词成功，白板单独获胜。`;
      const finishRes = await supabaseAdmin
        .from("rooms")
        .update({
          status: "finished",
          result_summary: summary,
        })
        .eq("id", room.id)
        .eq("status", "playing")
        .select("id")
        .maybeSingle();

      if (finishRes.error) {
        return NextResponse.json({ error: finishRes.error.message }, { status: 500 });
      }

      return NextResponse.json({
        ok: true,
        action: "whiteboard-solo-win",
        confidence: judged.confidence,
        reason: judged.reason,
      });
    }

    const winner = detectWinnerByRole(players);
    const baseSummary = `${sanitizeRoomSummary(room.result_summary)} 白板玩家 ${currentPlayer.name} 猜词失败。`;

    const updateRes = await supabaseAdmin
      .from("rooms")
      .update({
        status: winner ? "finished" : "playing",
        result_summary: winner ? `${baseSummary} 当前胜方：${winner}阵营。` : `${baseSummary} 请继续讨论，准备下一轮投票。`,
      })
      .eq("id", room.id)
      .eq("status", "playing")
      .select("id")
      .maybeSingle();

    if (updateRes.error) {
      return NextResponse.json({ error: updateRes.error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      action: "whiteboard-guess-failed",
      winner: winner ?? null,
      confidence: judged.confidence,
      reason: judged.reason,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
