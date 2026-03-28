import { NextRequest, NextResponse } from "next/server";

type GrokPair = {
  civilian: string;
  undercover: string;
};

type ChatContentPart = {
  type?: string;
  text?: string;
};

const readMessageContent = (
  content: string | ChatContentPart[] | undefined,
): string => {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => part.text ?? "")
      .filter(Boolean)
      .join("\n");
  }

  return "";
};

const parseJsonFromContent = (content: string): GrokPair[] => {
  const jsonCandidate = content.match(/\{[\s\S]*\}/)?.[0] ?? content;
  const parsed = JSON.parse(jsonCandidate) as {
    pairs?: Array<{ civilian?: string; undercover?: string }>;
    pair?: { civilian?: string; undercover?: string };
  };

  if (parsed.pair) {
    return [
      {
        civilian: parsed.pair.civilian?.trim() ?? "",
        undercover: parsed.pair.undercover?.trim() ?? "",
      },
    ].filter(
      (pair) =>
        pair.civilian.length > 0 &&
        pair.undercover.length > 0 &&
        pair.civilian !== pair.undercover,
    );
  }

  if (!Array.isArray(parsed.pairs)) {
    return [];
  }

  return parsed.pairs
    .map((pair) => ({
      civilian: pair.civilian?.trim() ?? "",
      undercover: pair.undercover?.trim() ?? "",
    }))
    .filter(
      (pair) =>
        pair.civilian.length > 0 &&
        pair.undercover.length > 0 &&
        pair.civilian !== pair.undercover,
    );
};

export async function POST(request: NextRequest) {
  const apiKey = process.env.GROK_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "缺少 GROK_API_KEY，请先在环境变量中配置。" },
      { status: 400 },
    );
  }

  const body = (await request.json()) as {
    category?: string;
  };

  const category = (body.category ?? "日常").trim();

  const apiUrl = process.env.GROK_API_URL ?? "https://api.x.ai/v1/chat/completions";
  const model = process.env.GROK_MODEL ?? "grok-4-1-fast";

  const prompt = [
    `你是一名“谁是卧底”词库策划。`,
    `请围绕类别“${category}”输出 1 组词条。`,
    "两个词必须容易混淆但不完全相同。",
    "严格返回 JSON，格式为：",
    '{"pair":{"civilian":"平民词","undercover":"卧底词"}}',
    "不要返回 markdown，不要返回解释文字。",
  ].join("\n");

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        stream: false,
        temperature: 0.8,
        messages: [
          {
            role: "system",
            content: "你只输出可解析 JSON。",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        {
          error: `Grok 请求失败（${response.status}）：${errorText.slice(0, 300)}`,
        },
        { status: 502 },
      );
    }

    const data = (await response.json()) as {
      choices?: Array<{
        message?: { content?: string | ChatContentPart[] };
      }>;
    };

    const content = readMessageContent(data.choices?.[0]?.message?.content);
    const pairs = parseJsonFromContent(content).slice(0, 1);

    if (pairs.length === 0) {
      return NextResponse.json(
        { error: "Grok 未返回可用词条，请重试。" },
        { status: 502 },
      );
    }

    return NextResponse.json({ pair: pairs[0] });
  } catch (error) {
    return NextResponse.json(
      {
        error: `生成词条失败：${error instanceof Error ? error.message : "未知错误"}`,
      },
      { status: 500 },
    );
  }
}
