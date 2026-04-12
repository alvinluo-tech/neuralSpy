"use client";

import { useParams } from "next/navigation";
import { RoomGame } from "@/components/RoomGame";
import { useTrackPage } from "@/hooks/useTrackPage";

export default function LobbyPage() {
  const params = useParams();
  const roomId = params.id as string;

  useTrackPage("/room/lobby", "Room Lobby");

  return <RoomGame roomId={roomId} pageType="lobby" />;
}
