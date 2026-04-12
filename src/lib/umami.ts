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

  const umami = (window as any).umami;
  if (!umami?.track) return;

  const url = customUrl ? getCanonicalUrl(customUrl) : getCanonicalUrl(window.location.pathname);
  const title = customTitle || document.title;

  umami.track((props: UmamiPayload) => ({
    ...props,
    url,
    title,
  }));
};

/**
 * Track a custom event
 * @param eventName - The event name
 * @param data - Optional event data
 */
export const trackEvent = (eventName: string, data?: Record<string, any>): void => {
  if (typeof window === "undefined") return;

  const umami = (window as any).umami;
  if (!umami?.track) return;

  if (data) {
    umami.track(eventName, data);
  } else {
    umami.track(eventName);
  }
};

/**
 * Identify a user session
 * @param sessionId - Unique session identifier
 * @param data - Optional session data
 */
export const identifySession = (sessionId: string, data?: Record<string, any>): void => {
  if (typeof window === "undefined") return;

  const umami = (window as any).umami;
  if (!umami?.identify) return;

  if (data) {
    umami.identify(sessionId, data);
  } else {
    umami.identify(sessionId);
  }
};
