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

const normalizeProvider = (value: string | undefined): "groq" | "grok" | null => {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "groq") {
    return "groq";
  }
  if (normalized === "grok" || normalized === "xai") {
    return "grok";
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

const toPair = (value: unknown): GrokPair | null => {
  if (!value || typeof value !== "object") return null;

  const record = value as Record<string, unknown>;
  const civilian = typeof record.civilian === "string" ? record.civilian.trim() : "";
  const undercover = typeof record.undercover === "string" ? record.undercover.trim() : "";

  if (!civilian || !undercover || civilian === undercover) return null;
  return { civilian, undercover };
};

const toPairs = (value: unknown): GrokPair[] => {
  if (Array.isArray(value)) {
    return value.map((item) => toPair(item)).filter((item): item is GrokPair => item !== null);
  }

  const single = toPair(value);
  return single ? [single] : [];
};

const extractPairsFromParsed = (parsed: unknown): GrokPair[] => {
  if (Array.isArray(parsed)) {
    return toPairs(parsed);
  }

  if (!parsed || typeof parsed !== "object") {
    return [];
  }

  const record = parsed as Record<string, unknown>;

  const fromDirect = toPair(record);
  if (fromDirect) {
    return [fromDirect];
  }

  const fromPairField = toPairs(record.pair);
  if (fromPairField.length > 0) {
    return fromPairField;
  }

  const fromPairsField = toPairs(record.pairs);
  if (fromPairsField.length > 0) {
    return fromPairsField;
  }

  const fromData = extractPairsFromParsed(record.data);
  if (fromData.length > 0) {
    return fromData;
  }

  return [];
};

const extractFencedJsonCandidates = (content: string): string[] => {
  const candidates: string[] = [];
  const regex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null = regex.exec(content);

  while (match) {
    const candidate = (match[1] ?? "").trim();
    if (candidate) {
      candidates.push(candidate);
    }
    match = regex.exec(content);
  }

  return candidates;
};

const extractBalancedJsonCandidates = (content: string): string[] => {
  const candidates: string[] = [];
  const matchingClose = (token: string) => (token === "{" ? "}" : "]");

  let start = -1;
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];

    if (start < 0) {
      if (char === "{" || char === "[") {
        start = index;
        stack.push(char);
      }
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{" || char === "[") {
      stack.push(char);
      continue;
    }

    if (char !== "}" && char !== "]") {
      continue;
    }

    const open = stack[stack.length - 1];
    if (!open || matchingClose(open) !== char) {
      start = -1;
      stack.length = 0;
      inString = false;
      escaped = false;
      continue;
    }

    stack.pop();

    if (stack.length === 0) {
      const candidate = content.slice(start, index + 1).trim();
      if (candidate) {
        candidates.push(candidate);
      }
      start = -1;
    }
  }

  return candidates;
};

const parseJsonFromContent = (content: string): GrokPair[] => {
  const rawCandidates = [
    content.trim(),
    ...extractFencedJsonCandidates(content),
    ...extractBalancedJsonCandidates(content),
    content.match(/\{[\s\S]*\}/)?.[0] ?? "",
    content.match(/\[[\s\S]*\]/)?.[0] ?? "",
  ];

  const candidates = Array.from(
    new Set(rawCandidates.map((item) => item.trim()).filter(Boolean)),
  );

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      const pairs = extractPairsFromParsed(parsed);
      if (pairs.length > 0) {
        return pairs;
      }
    } catch {
      // Continue trying other candidate blocks.
    }
  }

  return [];
};

// 简易的内存 IP 限流字典 (适用于 Serverless 单实例级别的基础防护)
const ipRateLimitMap = new Map<string, { count: number; resetTime: number }>();
const IP_LIMIT_MAX = 20; // 限制每个 IP 每分钟 20 次请求
const IP_LIMIT_WINDOW_MS = 60 * 1000;

function checkIpRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = ipRateLimitMap.get(ip);

  if (!record || now > record.resetTime) {
    ipRateLimitMap.set(ip, { count: 1, resetTime: now + IP_LIMIT_WINDOW_MS });
    return true;
  }

  if (record.count >= IP_LIMIT_MAX) {
    return false;
  }

  record.count += 1;
  return true;
}

export async function POST(request: NextRequest) {
  // 静默限流：获取客户端 IP
  const ip = request.headers.get("x-forwarded-for") ?? "unknown";
  if (ip !== "unknown" && !checkIpRateLimit(ip)) {
    return NextResponse.json(
      { error: "Too Many Requests. Please try again later." },
      { status: 429 }
    );
  }

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
  const defaultGroqModel = process.env.GROQ_MODEL ?? "qwen/qwen3-32b";
  const defaultGrokModel = process.env.GROK_MODEL ?? "grok-4-1-fast";

  const defaultProvider = normalizeProvider(process.env.WORDS_AI_PROVIDER) ?? "grok";
  const requestedProvider = normalizeProvider(body.provider) ?? defaultProvider;
  if (body.provider && requestedProvider !== "groq" && requestedProvider !== "grok") {
    return NextResponse.json(
      {
        error: "当前仅支持 Groq 和 Grok provider，暂不支持该 provider。",
        provider: (body.provider ?? "").trim().toLowerCase() || "unknown",
        model: requestedModel || "unknown",
      },
      { status: 400 },
    );
  }

  const model = requestedModel && requestedModel.length > 0
    ? requestedModel.slice(0, 120)
    : (requestedProvider === "grok" ? defaultGrokModel : defaultGroqModel);

  const apiKey = requestedProvider === "grok" ? process.env.GROK_API_KEY : process.env.GROQ_API_KEY;
  const apiUrl = requestedProvider === "grok" 
    ? (process.env.GROK_API_URL ?? "https://api.x.ai/v1/chat/completions")
    : (process.env.GROQ_API_URL ?? "https://api.groq.com/openai/v1/chat/completions");

  if (!apiKey) {
    return NextResponse.json(
      {
        error: `缺少 ${requestedProvider === "grok" ? "GROK_API_KEY" : "GROQ_API_KEY"}，请先在环境变量中配置。`,
        provider: requestedProvider,
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
          error: `${requestedProvider} 请求失败（${response.status}）：${errorText.slice(0, 300)}`,
          provider: requestedProvider,
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
          error: `${requestedProvider} 未返回可用词条，请重试。`,
          provider: requestedProvider,
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
        provider: requestedProvider,
        model,
      },
      requestedProvider,
      model,
    );

    return NextResponse.json({
      pair: pairs[0],
      provider: requestedProvider,
      model,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: `生成词条失败：${error instanceof Error ? error.message : "未知错误"}`,
        provider: requestedProvider,
        model,
      },
      { status: 500 },
    );
  }
}
