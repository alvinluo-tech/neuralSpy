"use client";

import { useParams } from "next/navigation";
import { RoomGame } from "@/components/RoomGame";
import { useTrackPage } from "@/hooks/useTrackPage";

export default function PlayPage() {
  const params = useParams();
  const roomId = params.id as string;

  useTrackPage("/room/play", "Room Play");

  return <RoomGame roomId={roomId} pageType="play" />;
}
