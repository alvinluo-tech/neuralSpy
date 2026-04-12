import { ReactNode } from "react";

type RoomLayoutProps = {
  children: ReactNode;
  params: Promise<{ id: string }>;
};

export default async function RoomLayout({ children, params }: RoomLayoutProps) {
  await params;
  return children;
}
