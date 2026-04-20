"use client";

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { useCategorySearch } from "@/hooks/useCategorySearch";
import { MIN_ROOM_PLAYERS, MAX_ROOM_PLAYERS, DEFAULT_ROOM_MAX_PLAYERS } from "@/lib/constants";
import { clamp } from "@/lib/utils";

export type CreateRoomData = {
  nickname: string;
  category: string;
  undercoverCount: number;
  maxPlayers: number;
  isPublic: boolean;
  voteEnabled: boolean;
  voteDurationSeconds: number;
};

type CreateRoomFormProps = {
  initialNickname?: string;
  initialIsPublic?: boolean;
  busy?: boolean;
  onCancel: () => void;
  onSubmit: (data: CreateRoomData) => void;
};

const normalizeVoteDurationSeconds = (value: number | null | undefined) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return 60;
  const normalized = Math.trunc(value);
  return normalized >= 0 ? normalized : 0;
};

export function CreateRoomForm({
  initialNickname = "",
  initialIsPublic = false,
  busy = false,
  onCancel,
  onSubmit,
}: CreateRoomFormProps) {
  const [nickname, setNickname] = useState(initialNickname);
  const [createCategory, setCreateCategory] = useState("游戏");
  const [createUndercoverCount, setCreateUndercoverCount] = useState(1);
  const [createMaxPlayers, setCreateMaxPlayers] = useState(DEFAULT_ROOM_MAX_PLAYERS);
  const [createIsPublic, setCreateIsPublic] = useState(initialIsPublic);
  const [createVoteEnabled, setCreateVoteEnabled] = useState(true);
  const [createVoteDurationSeconds, setCreateVoteDurationSeconds] = useState(60);

  const [categorySearchQuery, setCategorySearchQuery] = useState("");
  const [categorySearchOpen, setCategorySearchOpen] = useState(false);
  const { buildCategorySuggestions } = useCategorySearch();

  const categorySuggestions = useMemo(
    () => buildCategorySuggestions(categorySearchQuery),
    [buildCategorySuggestions, categorySearchQuery]
  );

  const handleSubmit = () => {
    onSubmit({
      nickname,
      category: createCategory,
      undercoverCount: createUndercoverCount,
      maxPlayers: createMaxPlayers,
      isPublic: createIsPublic,
      voteEnabled: createVoteEnabled,
      voteDurationSeconds: createVoteDurationSeconds,
    });
  };

  return (
    <section className="panel-grid entry-grid entry-single-grid">
      <article className="panel">
        <div className="entry-form-head">
          <h2>创建房间</h2>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
            返回选择
          </Button>
        </div>

        <label>
          你的昵称
          <input
            type="text"
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
            placeholder="例如：Alex"
            disabled={busy}
          />
        </label>
        <label>
          本局类别
          <div
            className="category-picker"
            onBlur={() => {
              window.setTimeout(() => setCategorySearchOpen(false), 120);
            }}
          >
            <input
              type="text"
              className="category-picker-input"
              value={categorySearchQuery}
              onChange={(event) => {
                setCategorySearchQuery(event.target.value);
                setCreateCategory(event.target.value.trim() || createCategory);
              }}
              onFocus={() => setCategorySearchOpen(true)}
              placeholder="搜索分类..."
              disabled={busy}
            />
            {categorySearchOpen && (
              <div className="category-menu">
                <div className="category-menu-header">
                  {categorySearchQuery.trim() ? "模糊匹配结果" : "Top10 热门种类词"}
                </div>

                {categorySuggestions.length === 0 && categorySearchQuery.trim() ? (
                  <div className="category-empty">没有匹配结果，继续输入可自定义类别。</div>
                ) : (
                  categorySuggestions.map((item) => (
                    <Button
                      key={item.key}
                      type="button"
                      variant="ghost"
                      size="sm"
                      className={`category-option${createCategory === item.subcategoryDisplayName ? " active" : ""}`}
                      onClick={() => {
                        setCreateCategory(item.subcategoryDisplayName);
                        setCategorySearchQuery(item.subcategoryDisplayName);
                        setCategorySearchOpen(false);
                      }}
                    >
                      <div className="category-option-title">{item.subcategoryDisplayName}</div>
                      <div className="category-option-meta">
                        {item.categoryDisplayName}
                        {item.examples.length > 0 ? ` · 例：${item.examples.join(" vs ")}` : ""}
                        {item.usageCount > 0 ? ` · 热度 ${item.usageCount}` : ""}
                      </div>
                    </Button>
                  ))
                )}

                {categorySearchQuery.trim() && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="category-option custom"
                    onClick={() => {
                      setCreateCategory(categorySearchQuery.trim());
                      setCategorySearchOpen(false);
                    }}
                  >
                    使用“{categorySearchQuery.trim()}”作为自定义类别
                  </Button>
                )}
              </div>
            )}
          </div>
          <p className="category-current">
            当前选择：<strong>{createCategory || "未选择"}</strong>
          </p>
        </label>
        <label>
          卧底人数（开局时随机分配）
          <input
            type="number"
            min={1}
            max={3}
            value={createUndercoverCount}
            onChange={(event) => setCreateUndercoverCount(clamp(Number(event.target.value) || 1, 1, 3))}
            disabled={busy}
          />
        </label>
        <label>
          最大人数（{MIN_ROOM_PLAYERS}-{MAX_ROOM_PLAYERS}）
          <input
            type="number"
            min={MIN_ROOM_PLAYERS}
            max={MAX_ROOM_PLAYERS}
            value={createMaxPlayers}
            onChange={(event) =>
              setCreateMaxPlayers(clamp(Number(event.target.value) || DEFAULT_ROOM_MAX_PLAYERS, MIN_ROOM_PLAYERS, MAX_ROOM_PLAYERS))
            }
            disabled={busy}
          />
          <p className="hint">满员后不可加入新玩家；建议 6-10 人体验更佳。</p>
        </label>
        <label className="check-line">
          <input
            type="checkbox"
            checked={createIsPublic}
            onChange={(event) => setCreateIsPublic(event.target.checked)}
            disabled={busy}
          />
          公开到社区大厅
        </label>
        <label className="check-line">
          <input
            type="checkbox"
            checked={createVoteEnabled}
            onChange={(event) => setCreateVoteEnabled(event.target.checked)}
            disabled={busy}
          />
          启用投票功能
        </label>
        <AnimatePresence initial={false}>
          {createVoteEnabled && (
            <motion.div
              key="vote-duration-field"
              initial={{ opacity: 0, y: -8, height: 0 }}
              animate={{ opacity: 1, y: 0, height: "auto" }}
              exit={{ opacity: 0, y: -8, height: 0 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="motion-collapse"
            >
              <label>
                每轮投票限时（秒）
                <input
                  type="number"
                  min={0}
                  value={createVoteDurationSeconds}
                  onChange={(event) =>
                    setCreateVoteDurationSeconds(normalizeVoteDurationSeconds(Number(event.target.value)))
                  }
                  disabled={busy}
                />
              </label>
            </motion.div>
          )}
        </AnimatePresence>
        <Button
          type="button"
          variant="primary"
          className={busy ? "loading" : undefined}
          onClick={handleSubmit}
          disabled={busy}
        >
          {busy ? "处理中..." : "创建房间"}
        </Button>
      </article>
    </section>
  );
}
