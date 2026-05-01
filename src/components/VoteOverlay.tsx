"use client";

import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/components/ui/button";

type VoteCandidateOption = {
  key: string;
  value: string;
  title: string;
  meta: string;
  isAbstain: boolean;
};

type VoteOverlayProps = {
  open: boolean;
  onClose: () => void;
  voteRound: number;
  voteDurationSeconds: number;
  voteCandidateIds: string[];
  voteTargetId: string;
  onVoteTargetIdChange: (id: string) => void;
  roomLogicBusy: boolean;
  roomSyncing: boolean;
  votedCount: number;
  eligibleVoterCount: number;
  canCurrentPlayerVote: boolean;
  canSubmitVote: boolean;
  hasVoteSelection: boolean;
  voteInlineStatus: string | null;
  remainingVoteSeconds: number | null;
  restrictedTieBreak: boolean;
  tieCandidateNames: string[];
  voteCandidateOptions: VoteCandidateOption[];
  onCastVote: () => void;
};

function VoteCountdownRing({ remainingSeconds, totalSeconds }: { remainingSeconds: number; totalSeconds: number }) {
  const safeTotal = Math.max(1, totalSeconds);
  const clampedRemaining = Math.max(0, Math.min(remainingSeconds, safeTotal));
  const percentage = (clampedRemaining / safeTotal) * 100;
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  const isUrgent = clampedRemaining <= 10;

  return (
    <div className="vote-countdown" role="timer" aria-live="polite" aria-label={`剩余 ${clampedRemaining} 秒`}>
      <svg viewBox="0 0 100 100" className="vote-countdown-svg" aria-hidden="true">
        <circle cx="50" cy="50" r={radius} className="vote-countdown-bg" />
        <circle
          cx="50"
          cy="50"
          r={radius}
          className={`vote-countdown-fg${isUrgent ? " urgent" : ""}`}
          style={{
            strokeDasharray: circumference,
            strokeDashoffset: circumference * (1 - percentage / 100),
          }}
        />
      </svg>
      <div className="vote-countdown-text">
        <strong>{clampedRemaining}</strong>
        <span>秒</span>
      </div>
    </div>
  );
}

export function VoteOverlay({
  open,
  onClose,
  voteRound,
  voteDurationSeconds,
  voteCandidateIds,
  voteTargetId,
  onVoteTargetIdChange,
  roomLogicBusy,
  roomSyncing,
  votedCount,
  eligibleVoterCount,
  canCurrentPlayerVote,
  canSubmitVote,
  hasVoteSelection,
  voteInlineStatus,
  remainingVoteSeconds,
  restrictedTieBreak,
  tieCandidateNames,
  voteCandidateOptions,
  onCastVote,
}: VoteOverlayProps) {
  const firstCandidateRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      firstCandidateRef.current?.focus();
    }, 200);
    return () => window.clearTimeout(timer);
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="vote-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="本轮投票"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
        >
          <motion.div
            className="vote-overlay-card"
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
          >
            <div className="vote-head-row">
              <h3>本轮投票</h3>
              <p className="hint vote-head-count">
                已投票人数：{votedCount}/{eligibleVoterCount}
              </p>
            </div>

            {voteInlineStatus && <p className="hint vote-inline-hint">{voteInlineStatus}</p>}

            <p className="hint">
              请选择一个目标，或选择"弃票"后再提交。
            </p>

            {remainingVoteSeconds != null && (
              <div className="vote-countdown-wrap">
                <VoteCountdownRing
                  remainingSeconds={remainingVoteSeconds}
                  totalSeconds={Math.max(1, voteDurationSeconds)}
                />
              </div>
            )}

            {voteCandidateIds.length > 0 && (
              <p className="hint">
                当前为平票加赛：候选人仅限
                {tieCandidateNames.length > 0
                  ? ` ${tieCandidateNames.join("、")}`
                  : " 平票玩家"}
                {restrictedTieBreak ? "；仅其余存活玩家可投票。" : "；本轮为全员平票，所有存活玩家可参与复投。"}
              </p>
            )}

            <div>
              <p className="vote-candidate-label">选择你怀疑的卧底</p>
              <div className="vote-candidate-grid" role="radiogroup" aria-label="投票候选区">
                {voteCandidateOptions.map((option, index) => {
                  const selected = voteTargetId === option.value;
                  return (
                    <Button
                      key={option.key}
                      ref={index === 0 ? firstCandidateRef : undefined}
                      type="button"
                      variant={selected ? "primary" : "ghost"}
                      size="sm"
                      className={`vote-candidate-chip${selected ? " selected" : ""}${option.isAbstain ? " abstain" : ""}`}
                      disabled={!canCurrentPlayerVote || roomLogicBusy}
                      aria-pressed={selected}
                      onClick={() => onVoteTargetIdChange(option.value)}
                    >
                      <span className="vote-candidate-title">{option.title}</span>
                      <span className="vote-candidate-meta">{option.meta}</span>
                    </Button>
                  );
                })}
              </div>
            </div>

            {canCurrentPlayerVote && !hasVoteSelection && (
              <p className="hint vote-gate-hint">请先选择投票对象或"弃票"。</p>
            )}

            <Button
              type="button"
              variant="primary"
              className={`${roomLogicBusy ? "loading " : ""}main-next-action`.trim()}
              onClick={onCastVote}
              disabled={roomLogicBusy || !canSubmitVote}
            >
              {roomLogicBusy ? "提交中..." : "提交/更新我的投票"}
            </Button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
