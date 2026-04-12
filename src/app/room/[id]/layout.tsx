import { ReactNode } from "react";

type RoomLayoutProps = {
  children: ReactNode;
  params: Promise<{ id: string }>;
};

export default async function RoomLayout({ children, params }: RoomLayoutProps) {
  const { id } = await params;

  // In the future, we could add server-side room validation here
  // For now, we let the child pages handle their own data loading

  return <>{children}</>;
}
