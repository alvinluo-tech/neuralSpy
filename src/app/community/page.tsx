"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { NoticeToast } from "@/components/ui/notice-toast";
import { useCommunityLobbyData, type CommunityRoom } from "@/hooks/useCommunityLobbyData";
import { RoomDrawer } from "@/components/community/RoomDrawer";
import { identifySession, trackEvent } from "@/lib/umami";

const SESSION_KEY = "undercover.session.id";
const PLAYER_NICKNAME_KEY = "undercover.lastNickname";

const safeGetSessionValue = (key: string) => {
  try {
    return sessionStorage.getItem(key);
  } catch {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }
};

const safeSetSessionValue = (key: string, value: string) => {
  try {
    sessionStorage.setItem(key, value);
    return;
  } catch {}

  try {
    localStorage.setItem(key, value);
  } catch {}
};

const randomSessionId = () => {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

function formatTime(ts: number) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function statusLabel(status: string) {
  if (status === "lobby") return "等待中";
  if (status === "playing") return "游戏中";
  if (status === "voting") return "投票中";
  if (status === "finished") return "已结束";
  return status;
}

function parseCreatedAtMs(value: string | undefined) {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function pickQuickStartRoom(rooms: CommunityRoom[], playerCounts: Record<string, number>) {
  const candidates = rooms
    .map((room) => {
      const count = playerCounts[room.id] ?? 0;
      const maxPlayers = typeof room.max_players === "number" ? room.max_players : 6;
      const remaining = maxPlayers - count;
      return { room, count, maxPlayers, remaining };
    })
    .filter((item) => item.room.status === "lobby" && item.remaining > 0 && item.remaining < item.maxPlayers);

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (a.remaining !== b.remaining) return a.remaining - b.remaining;
    if (a.count !== b.count) return b.count - a.count;
    const aTs = parseCreatedAtMs(a.room.created_at) ?? 0;
    const bTs = parseCreatedAtMs(b.room.created_at) ?? 0;
    return bTs - aTs;
  });

  const bestRemaining = candidates[0].remaining;
  const bestGroup = candidates.filter((item) => item.remaining === bestRemaining);
  const pool = bestGroup.slice(0, 3);
  const selected = pool[Math.floor(Math.random() * pool.length)] ?? candidates[0];
  return selected.room;
}

export default function CommunityPage() {
  const [sessionId, setSessionId] = useState("");
  const [nickname, setNickname] = useState("");
  const [toastError, setToastError] = useState("");

  const [drawerRoom, setDrawerRoom] = useState<CommunityRoom | null>(null);
  const [drawerAutoJoin, setDrawerAutoJoin] = useState(false);

  const { rooms, playerCounts, totalPlayers, loading, syncing, error, updatedAtMs, refresh } = useCommunityLobbyData();

  useEffect(() => {
    const rawSession = safeGetSessionValue(SESSION_KEY);
    const nextSessionId = rawSession || randomSessionId();
    setSessionId(nextSessionId);
    safeSetSessionValue(SESSION_KEY, nextSessionId);

    const storedNickname = safeGetSessionValue(PLAYER_NICKNAME_KEY);
    if (storedNickname) setNickname(storedNickname);
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    identifySession(sessionId, { nickname: nickname.trim() || undefined });
  }, [sessionId, nickname]);

  const roomsCount = rooms.length;
  const statsLine = useMemo(() => {
    return `● ${roomsCount} 个公开房间正在进行 | ${totalPlayers} 位玩家在线 | 更新时间 ${formatTime(updatedAtMs)}`;
  }, [roomsCount, totalPlayers, updatedAtMs]);

  const persistNickname = (value: string) => {
    safeSetSessionValue(PLAYER_NICKNAME_KEY, value);
  };

  const openRoom = (room: CommunityRoom) => {
    setDrawerRoom(room);
    setDrawerAutoJoin(false);
    trackEvent("community_room_opened", { roomCode: room.code });
  };

  const quickStart = () => {
    const target = pickQuickStartRoom(rooms, playerCounts);
    if (!target) {
      trackEvent("community_quickstart_no_room");
      window.location.href = "/?mode=create&public=1";
      return;
    }

    setDrawerRoom(target);
    setDrawerAutoJoin(true);
    trackEvent("community_quickstart_selected", { roomCode: target.code });
  };

  return (
    <div className="page-shell">
      <main className="app-wrap">
        <section className="hero-card">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="eyebrow">Community</p>
              <h1 className="hero-title">社区大厅</h1>
              <p className="hero-subtitle">浏览公开房间，点击查看后加入。创建房间会优先让更多人加入同一局，降低重复开房。</p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <Button
                type="button"
                variant="primary"
                onClick={() => {
                  if (!sessionId) {
                    setToastError("初始化未完成，请稍候。");
                    return;
                  }
                  quickStart();
                }}
                disabled={loading}
              >
                快速开始
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  trackEvent("community_back_home_clicked");
                  window.location.href = "/";
                }}
              >
                返回首页
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  void refresh(true);
                }}
                disabled={loading}
              >
                {loading ? "刷新中..." : "刷新"}
              </Button>
              {syncing && <span className="sync-hint text-sm">同步中</span>}
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
            <div className="text-sm text-[color:var(--muted)]">{statsLine}</div>
            <div className="text-sm text-[color:var(--muted)]">当前昵称：{nickname.trim() || "未设置"}</div>
          </div>
        </section>

        <section className="panel">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 style={{ marginBottom: 0 }}>公开房间</h2>
            {error && (
              <Button type="button" variant="outline" onClick={() => void refresh(true)}>
                重试
              </Button>
            )}
          </div>

          <p className="hint">仅展示最近 6 小时内、仍在等待中的公开房间。</p>

          {error ? (
            <p className="hint">加载失败：{error}</p>
          ) : rooms.length === 0 ? (
            <div>
              <p className="hint">暂无公开房间。你可以先创建一个公开房间，让路人也能加入。</p>
              <div className="actions-row" style={{ marginTop: 12 }}>
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => {
                    trackEvent("community_create_clicked");
                    window.location.href = "/?mode=create&public=1";
                  }}
                >
                  + 创建房间
                </Button>
              </div>
            </div>
          ) : (
            <ul className="m-0 mt-3 p-0 list-none grid gap-3">
              {rooms.map((room) => {
                const count = playerCounts[room.id] ?? 0;
                const maxPlayers = typeof room.max_players === "number" ? room.max_players : null;
                const isFull = maxPlayers !== null ? count >= maxPlayers : false;

                return (
                  <li key={room.id} className="panel" style={{ padding: 16 }}>
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="min-w-[260px]">
                        <div className="text-sm tracking-[0.14em] uppercase text-[color:var(--primary)] font-bold">
                          {room.code}
                        </div>
                        <div className="mt-1 font-semibold">{room.category || "日常"}</div>
                        <div className="text-sm text-[color:var(--muted)] mt-1">
                          {statusLabel(room.status)} · {count}{maxPlayers ? `/${maxPlayers}` : ""}
                          {isFull ? " · 已满" : ""}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant={isFull ? "secondary" : "primary"}
                          onClick={() => openRoom(room)}
                        >
                          查看
                        </Button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div className="fixed bottom-6 right-6 z-[1100] flex flex-col gap-2">
          <Button
            type="button"
            variant="primary"
            size="lg"
            onClick={() => {
              if (!sessionId) {
                setToastError("初始化未完成，请稍候。");
                return;
              }
              trackEvent("community_create_clicked");
              window.location.href = "/?mode=create&public=1";
            }}
          >
            + 创建房间
          </Button>
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={() => {
              if (!sessionId) {
                setToastError("初始化未完成，请稍候。");
                return;
              }
              trackEvent("community_invite_clicked");
              window.location.href = "/?mode=join";
            }}
          >
            # 输入邀请码
          </Button>
        </div>

        <RoomDrawer
          open={!!drawerRoom}
          room={drawerRoom}
          playerCount={drawerRoom ? playerCounts[drawerRoom.id] ?? 0 : 0}
          sessionId={sessionId}
          nickname={nickname}
          onNicknameChange={setNickname}
          persistNickname={persistNickname}
          autoJoin={drawerAutoJoin}
          onClose={() => setDrawerRoom(null)}
        />

        <NoticeToast type="error" message={toastError} onClose={() => setToastError("")} />
      </main>
    </div>
  );
}
