"use client";

import { useParams } from "next/navigation";
import { RoomGame } from "@/components/RoomGame";
import { useTrackPage } from "@/hooks/useTrackPage";

export default function ResultPage() {
  const params = useParams();
  const roomId = params.id as string;

  useTrackPage("/room/result", "Room Result");

  return <RoomGame roomId={roomId} pageType="result" />;
}
