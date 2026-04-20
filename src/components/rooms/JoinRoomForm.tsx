"use client";

import { useState, useRef, useEffect } from "react";
import type { ClipboardEvent, KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";

export const INVITE_CODE_LENGTH = 6;

type JoinRoomFormProps = {
  initialNickname?: string;
  initialJoinCodeSlots?: string[];
  busy?: boolean;
  onCancel: () => void;
  onSubmit: (nickname: string, code: string) => void;
};

export function JoinRoomForm({
  initialNickname = "",
  initialJoinCodeSlots = Array.from({ length: INVITE_CODE_LENGTH }, () => ""),
  busy = false,
  onCancel,
  onSubmit,
}: JoinRoomFormProps) {
  const [nickname, setNickname] = useState(initialNickname);
  const [joinCodeSlots, setJoinCodeSlots] = useState<string[]>(initialJoinCodeSlots);
  const joinCodeInputRefs = useRef<Array<HTMLInputElement | null>>([]);

  const focusJoinCodeInput = (index: number) => {
    if (index >= 0 && index < INVITE_CODE_LENGTH) {
      joinCodeInputRefs.current[index]?.focus();
    }
  };

  const handleJoinCodeInput = (index: number, value: string) => {
    if (busy) return;
    const char = value.slice(-1).toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (char) {
      const newSlots = [...joinCodeSlots];
      newSlots[index] = char;
      setJoinCodeSlots(newSlots);
      if (index < INVITE_CODE_LENGTH - 1) {
        focusJoinCodeInput(index + 1);
      }
    } else {
      const newSlots = [...joinCodeSlots];
      newSlots[index] = "";
      setJoinCodeSlots(newSlots);
    }
  };

  const handleJoinCodeKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (busy) return;
    if (event.key === "Backspace") {
      event.preventDefault();
      if (joinCodeSlots[index]) {
        const newSlots = [...joinCodeSlots];
        newSlots[index] = "";
        setJoinCodeSlots(newSlots);
      } else if (index > 0) {
        const newSlots = [...joinCodeSlots];
        newSlots[index - 1] = "";
        setJoinCodeSlots(newSlots);
        focusJoinCodeInput(index - 1);
      }
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      focusJoinCodeInput(index - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      focusJoinCodeInput(index + 1);
    }
  };

  const handleJoinCodePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    if (busy) return;
    event.preventDefault();
    const pasted = event.clipboardData
      .getData("text")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, INVITE_CODE_LENGTH);

    if (!pasted) return;

    const newSlots = [...joinCodeSlots];
    for (let i = 0; i < pasted.length; i++) {
      newSlots[i] = pasted[i];
    }
    setJoinCodeSlots(newSlots);

    const nextFocusIndex = Math.min(pasted.length, INVITE_CODE_LENGTH - 1);
    window.setTimeout(() => focusJoinCodeInput(nextFocusIndex), 0);
  };

  useEffect(() => {
    // When the form mounts, focus the correct input field
    const firstEmptyIndex = joinCodeSlots.findIndex((char) => !char);
    if (firstEmptyIndex === -1) {
      // Code is fully pre-filled, focus the nickname input instead
      const nicknameInput = document.getElementById("join-nickname-input");
      if (nicknameInput) {
        const timer = window.setTimeout(() => nicknameInput.focus(), 0);
        return () => window.clearTimeout(timer);
      }
      return;
    }
    const targetIndex = firstEmptyIndex;
    const timer = window.setTimeout(() => focusJoinCodeInput(targetIndex), 0);
    return () => window.clearTimeout(timer);
  }, [joinCodeSlots]);

  const handleSubmit = () => {
    onSubmit(nickname, joinCodeSlots.join(""));
  };

  return (
    <div
      className="join-drawer-overlay"
      onClick={() => {
        if (busy) return;
        onCancel();
      }}
    >
      <section className="join-drawer" onClick={(event) => event.stopPropagation()}>
        <div className="join-drawer-handle" aria-hidden="true" />
        <div className="entry-form-head">
          <h2>加入房间</h2>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
            返回
          </Button>
        </div>

        <label>
          你的昵称
          <input
            id="join-nickname-input"
            type="text"
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
            placeholder="例如：Bella"
            disabled={busy}
          />
        </label>

        <label>
          邀请码
          <div className="invite-code-grid" onPaste={handleJoinCodePaste}>
            {joinCodeSlots.map((char, index) => (
              <input
                key={`invite-slot-${index}`}
                ref={(element) => {
                  joinCodeInputRefs.current[index] = element;
                }}
                type="text"
                className={`invite-code-cell${char ? " filled" : ""}`}
                inputMode="text"
                autoComplete="one-time-code"
                maxLength={1}
                value={char}
                onChange={(event) => handleJoinCodeInput(index, event.target.value)}
                onKeyDown={(event) => handleJoinCodeKeyDown(index, event)}
                aria-label={`邀请码第 ${index + 1} 位`}
                disabled={busy}
              />
            ))}
          </div>
          <p className="hint">请输入 {INVITE_CODE_LENGTH} 位邀请码（字母或数字）。</p>
        </label>

        <Button
          type="button"
          variant="primary"
          className={busy ? "loading" : undefined}
          onClick={handleSubmit}
          disabled={busy}
        >
          {busy ? "处理中..." : "加入房间"}
        </Button>
      </section>
    </div>
  );
}
