export const RATE_LIMIT_PREFIX = "undercover.ratelimit.";

/**
 * 检查基于 LocalStorage 的客户端静默限流
 * @param action 限流动作标识（如 "createRoom"）
 * @param maxRequests 允许的最大请求次数
 * @param windowMs 时间窗口（毫秒）
 * @returns 是否允许请求 (true: 允许, false: 被限流)
 */
export function checkClientRateLimit(action: string, maxRequests: number, windowMs: number): boolean {
  if (typeof window === "undefined") return true;

  const now = Date.now();
  const key = `${RATE_LIMIT_PREFIX}${action}`;
  const recordStr = localStorage.getItem(key);

  let records: number[] = [];
  if (recordStr) {
    try {
      records = JSON.parse(recordStr);
    } catch (e) {
      // 忽略解析错误，重置记录
      records = [];
    }
  }

  // 过滤掉不在当前时间窗口内的旧记录
  records = records.filter((timestamp) => now - timestamp < windowMs);

  // 如果当前窗口内的请求次数已经达到上限，触发限流
  if (records.length >= maxRequests) {
    return false;
  }

  // 记录本次请求
  records.push(now);
  localStorage.setItem(key, JSON.stringify(records));
  
  return true;
}
