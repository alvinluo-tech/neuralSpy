import { NextRequest, NextResponse } from "next/server";

type GrokPair = {
  civilian: string;
  undercover: string;
};

type ChatContentPart = {
  type?: string;
  text?: string;
};

type AiTrackingPayload = {
  room_id?: string;
  round_number?: number;
  attempt?: number;
  is_random_all_mode?: boolean;
  category?: string;
  provider?: string;
  model?: string;
};

const UMAMI_HOST_URL = "https://cloud.umami.is";
const UMAMI_WEBSITE_ID = "f3bea32c-328c-4bf2-86f1-6d89fab43cd2";
const MAX_EVENT_NAME_LENGTH = 50;

const MODEL_EVENT_PREFIX_ALIASES: Record<string, string> = {
  AI_Word_Generation_Success: "AIWG_Success",
};

const normalizeProvider = (value: string | undefined): "groq" | null => {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "groq") {
    return "groq";
  }

  return null;
};

const hashEventName = (value: string) => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
};

const normalizeEventName = (eventName: string) => {
  if (eventName.length <= MAX_EVENT_NAME_LENGTH) return eventName;
  const suffix = hashEventName(eventName).slice(0, 8);
  const prefixLength = MAX_EVENT_NAME_LENGTH - suffix.length - 1;
  return `${eventName.slice(0, prefixLength)}_${suffix}`;
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

const getTrackingRequestContext = (request: NextRequest) => {
  const referer = request.headers.get("referer");
  const fallbackOrigin = `https://${request.headers.get("host") ?? "localhost"}`;
  const refererUrl = referer ? new URL(referer) : new URL("/", fallbackOrigin);

  return {
    hostname: refererUrl.hostname || request.headers.get("host") || "localhost",
    language: request.headers.get("accept-language")?.split(",")[0]?.trim() || "zh-CN",
    referrer: referer ?? "",
    title: "AI Word Generation",
    url: `${refererUrl.pathname}${refererUrl.search}`,
    userAgent: request.headers.get("user-agent") || "NeuralSpy/1.0",
  };
};

const sendUmamiEvent = async (
  request: NextRequest,
  eventName: string,
  data?: Record<string, string | number | boolean | null | undefined>,
) => {
  const context = getTrackingRequestContext(request);

  await fetch(`${UMAMI_HOST_URL}/api/send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": context.userAgent,
    },
    body: JSON.stringify({
      payload: {
        hostname: context.hostname,
        language: context.language,
        referrer: context.referrer,
        title: context.title,
        url: context.url,
        website: UMAMI_WEBSITE_ID,
        name: normalizeEventName(eventName),
        data,
      },
      type: "event",
    }),
    cache: "no-store",
  }).catch(() => undefined);
};

const trackAiWordGenerationSuccess = async (
  request: NextRequest,
  payload: AiTrackingPayload,
  provider: string,
  model: string,
) => {
  const providerToken = toEventToken(provider, "groq");
  const modelToken = toModelEventToken(model);
  const modelEventPrefix =
    MODEL_EVENT_PREFIX_ALIASES.AI_Word_Generation_Success ?? "AI_Word_Generation_Success";

  await Promise.allSettled([
    sendUmamiEvent(request, "AI_Word_Generation_Success", payload),
    sendUmamiEvent(request, `${modelEventPrefix}_${providerToken}_${modelToken}`, payload),
  ]);
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
  const body = (await request.json()) as {
    category?: string;
    excludedPairs?: string[];
    provider?: string;
    model?: string;
    tracking?: AiTrackingPayload;
  };

  const category = (body.category ?? "日常").trim();
  const excludedPairs = Array.isArray(body.excludedPairs)
    ? body.excludedPairs.map((item) => item.trim()).filter(Boolean).slice(0, 80)
    : [];

  const requestedModel = body.model?.trim();
  const defaultModel = process.env.GROQ_MODEL ?? "qwen/qwen3-32b";
  const model = requestedModel && requestedModel.length > 0
    ? requestedModel.slice(0, 120)
    : defaultModel;

  const requestedProvider = normalizeProvider(body.provider);
  if (body.provider && !requestedProvider) {
    return NextResponse.json(
      {
        error: "当前仅支持 Groq provider，暂不支持该 provider。",
        provider: (body.provider ?? "").trim().toLowerCase() || "unknown",
        model,
      },
      { status: 400 },
    );
  }

  const apiKey = process.env.GROQ_API_KEY;
  const apiUrl = process.env.GROQ_API_URL ?? "https://api.groq.com/openai/v1/chat/completions";

  if (!apiKey) {
    return NextResponse.json(
      {
        error: "缺少 GROQ_API_KEY，请先在环境变量中配置。",
        provider: "groq",
        model,
      },
      { status: 400 },
    );
  }

  const prompt = [
    `你是一名“谁是卧底”词库策划。`,
    `请围绕类别“${category}”输出 1 组词条。`,
    "两个词必须容易混淆但不完全相同。",
    "严格返回 JSON，格式为：",
    '{"pair":{"civilian":"平民词","undercover":"卧底词"}}',
    excludedPairs.length > 0
      ? `禁止输出以下任意词组（包含顺序互换也视为重复）：${excludedPairs.join("；")}`
      : "",
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
          error: `Groq 请求失败（${response.status}）：${errorText.slice(0, 300)}`,
          provider: "groq",
          model,
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
        {
          error: "Groq 未返回可用词条，请重试。",
          provider: "groq",
          model,
        },
        { status: 502 },
      );
    }

    await trackAiWordGenerationSuccess(
      request,
      {
        ...body.tracking,
        category,
        provider: "groq",
        model,
      },
      "groq",
      model,
    );

    return NextResponse.json({
      pair: pairs[0],
      provider: "groq",
      model,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: `生成词条失败：${error instanceof Error ? error.message : "未知错误"}`,
        provider: "groq",
        model,
      },
      { status: 500 },
    );
  }
}
