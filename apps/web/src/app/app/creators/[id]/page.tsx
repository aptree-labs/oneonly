import { notFound } from "next/navigation";
import { CreatorProfile } from "@/components/creator-fees/creator-profile";
export const metadata = { title: "Creator" };
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!/^[1-9]\d{0,24}$/.test(id)) notFound();
  return <CreatorProfile key={id} id={id} />;
}
