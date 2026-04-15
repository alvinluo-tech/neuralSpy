"use client";

import { useEffect } from "react";
import { useRef } from "react";
import { Button } from "@/components/ui/button";

type NoticeToastProps = {
  type: "success" | "error" | "info";
  message: string;
  onClose: () => void;
  durationMs?: number;
  autoDismiss?: boolean;
  showClose?: boolean;
};

export function NoticeToast({
  type,
  message,
  onClose,
  durationMs = 4000,
  autoDismiss = true,
  showClose = true,
}: NoticeToastProps) {
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!message || !autoDismiss) return;
    const timer = window.setTimeout(() => {
      closeRef.current();
    }, durationMs);
    return () => window.clearTimeout(timer);
  }, [message, durationMs, autoDismiss]);

  if (!message) return null;

  return (
    <div className={`notice notice-toast ${type}`} role="status" aria-live="polite">
      <span className="notice-toast-text">{message}</span>
      {showClose && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="notice-toast-close"
          onClick={onClose}
          aria-label="关闭提示"
        >
          ×
        </Button>
      )}
    </div>
  );
}
