/**
 * Umami analytics utilities
 * Provides manual pageview tracking with route canonicalization
 * Maps dynamic routes like /room/[roomId]/play to /room/play for cleaner analytics
 */

type UmamiPayload = {
  website?: string;
  url?: string;
  title?: string;
  referrer?: string;
  language?: string;
  screen?: string;
  hostname?: string;
};

type UmamiEventData = Record<string, string | number | boolean | null | undefined>;

type UmamiTracker = {
  track: {
    (mapper: (props: UmamiPayload) => UmamiPayload): void;
    (eventName: string, data?: UmamiEventData): void;
  };
  identify: (sessionId: string, data?: UmamiEventData) => void;
};

type PendingUmamiAction = (tracker: UmamiTracker) => void;

const MAX_EVENT_NAME_LENGTH = 50;
const UMAMI_WAIT_INTERVAL_MS = 250;
const MAX_UMAMI_WAIT_ATTEMPTS = 40;

const pendingUmamiActions: PendingUmamiAction[] = [];

let pendingFlushTimer: number | null = null;
let pendingFlushAttempts = 0;

declare global {
  interface Window {
    umami?: UmamiTracker;
  }
}

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

const getUmamiTracker = () => {
  if (typeof window === "undefined") return null;
  return window.umami ?? null;
};

const safelyRunUmamiAction = (tracker: UmamiTracker, action: PendingUmamiAction) => {
  try {
    action(tracker);
  } catch {}
};

const flushPendingUmamiActions = () => {
  const tracker = getUmamiTracker();
  if (!tracker) return false;

  while (pendingUmamiActions.length > 0) {
    const action = pendingUmamiActions.shift();
    if (action) {
      safelyRunUmamiAction(tracker, action);
    }
  }

  return true;
};

const schedulePendingUmamiFlush = () => {
  if (typeof window === "undefined" || pendingFlushTimer != null) return;

  const attemptFlush = () => {
    if (flushPendingUmamiActions() || pendingFlushAttempts >= MAX_UMAMI_WAIT_ATTEMPTS) {
      pendingFlushTimer = null;
      pendingFlushAttempts = 0;
      return;
    }

    pendingFlushAttempts += 1;
    pendingFlushTimer = window.setTimeout(attemptFlush, UMAMI_WAIT_INTERVAL_MS);
  };

  pendingFlushTimer = window.setTimeout(attemptFlush, UMAMI_WAIT_INTERVAL_MS);
};

const runOrQueueUmamiAction = (action: PendingUmamiAction) => {
  const tracker = getUmamiTracker();
  if (tracker) {
    safelyRunUmamiAction(tracker, action);
    return;
  }

  pendingUmamiActions.push(action);
  schedulePendingUmamiFlush();
};

/**
 * Get the canonical URL for analytics
 * Removes dynamic route parameters (e.g., /room/abc123/play -> /room/play)
 */
const getCanonicalUrl = (currentUrl: string): string => {
  try {
    const url = new URL(currentUrl, typeof window !== "undefined" ? window.location.origin : "http://localhost");
    const pathname = url.pathname;

    // Pattern: /room/[any-uuid-or-code]/xxx -> /room/xxx
    const roomPattern = /^\/room\/[^\/]+\//;
    if (roomPattern.test(pathname)) {
      return pathname.replace(roomPattern, "/room/");
    }

    return pathname;
  } catch {
    return currentUrl;
  }
};

/**
 * Track a pageview with canonical URL
 * @param customUrl - Optional custom URL (defaults to current location)
 * @param customTitle - Optional custom title (defaults to document title)
 */
export const trackPageView = (customUrl?: string, customTitle?: string): void => {
  if (typeof window === "undefined") return;

  const url = customUrl ? getCanonicalUrl(customUrl) : getCanonicalUrl(window.location.pathname);
  const title = customTitle || document.title;

  runOrQueueUmamiAction((tracker) => {
    tracker.track((props: UmamiPayload) => ({
      ...props,
      url,
      title,
    }));
  });
};

/**
 * Track a custom event
 * @param eventName - The event name
 * @param data - Optional event data
 */
export const trackEvent = (eventName: string, data?: UmamiEventData): void => {
  if (typeof window === "undefined") return;
  const normalizedEventName = normalizeEventName(eventName);

  runOrQueueUmamiAction((tracker) => {
    if (data) {
      tracker.track(normalizedEventName, data);
    } else {
      tracker.track(normalizedEventName);
    }
  });
};

/**
 * Identify a user session
 * @param sessionId - Unique session identifier
 * @param data - Optional session data
 */
export const identifySession = (sessionId: string, data?: UmamiEventData): void => {
  if (typeof window === "undefined") return;
  runOrQueueUmamiAction((tracker) => {
    if (data) {
      tracker.identify(sessionId, data);
    } else {
      tracker.identify(sessionId);
    }
  });
};
