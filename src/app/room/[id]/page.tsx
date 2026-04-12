"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

type RoomRow = {
  id: string;
  code: string;
  status: "lobby" | "playing" | "voting" | "finished";
};

export default function RoomPage() {
  const router = useRouter();
  const params = useParams();
  const roomId = params.id as string;
  const [error, setError] = useState("");

  const navigateByStatus = useCallback(
    (status: RoomRow["status"]) => {
      const nextPath =
        status === "lobby"
          ? `/room/${roomId}/lobby`
          : status === "finished"
            ? `/room/${roomId}/result`
            : `/room/${roomId}/play`;
      router.push(nextPath);
    },
    [roomId, router],
  );

  useEffect(() => {
    if (!roomId) return;
    let redirectTimer: ReturnType<typeof setTimeout> | null = null;

    const loadRoomAndNavigate = async () => {
      try {
        const { data, error: fetchError } = await supabase
          .from("rooms")
          .select("id, code, status")
          .eq("id", roomId)
          .single();

        if (fetchError) {
          setError("房间不存在或已解散");
          redirectTimer = setTimeout(() => router.push("/"), 2000);
          return;
        }

        const room = data as RoomRow;
        navigateByStatus(room.status);
      } catch (err) {
        setError("加载房间失败");
      }
    };

    loadRoomAndNavigate();

    // 监听房间状态变化，实时导航
    const channel = supabase
      .channel(`room-${roomId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rooms", filter: `id=eq.${roomId}` },
        (payload) => {
          const room = payload.new as RoomRow;
          navigateByStatus(room.status);
        }
      )
      .subscribe();

    return () => {
      if (redirectTimer) {
        clearTimeout(redirectTimer);
      }
      channel.unsubscribe();
    };
  }, [roomId, router, navigateByStatus]);

  return (
    <div style={{ textAlign: "center", padding: "20px" }}>
      {error ? (
        <>
          <p style={{ color: "red" }}>{error}</p>
          <p style={{ fontSize: "12px", color: "#999" }}>2秒后返回首页...</p>
        </>
      ) : (
        <p>加载房间中...</p>
      )}
    </div>
  );
}
