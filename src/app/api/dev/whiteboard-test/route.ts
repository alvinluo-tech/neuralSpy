import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "仅开发环境可用" }, { status: 403 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      targetWord?: string;
      guessedWord?: string;
    };

    const targetWord = body.targetWord?.trim();
    const guessedWord = body.guessedWord?.trim();

    if (!targetWord || !guessedWord) {
      return NextResponse.json({ error: "缺少 targetWord 或 guessedWord" }, { status: 400 });
    }

    const isCorrect = guessedWord.toLowerCase() === targetWord.toLowerCase();

    return NextResponse.json({
      ok: true,
      isSameMeaning: isCorrect,
      reason: isCorrect ? "完全一致" : "不一致",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
