import { redirect } from "next/navigation";
import { CreatorFees } from "@/components/creator-fees/dashboard";
export const metadata = {
  title: "Creator fees",
  robots: { index: false, follow: false },
};
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ recipient?: string }>;
}) {
  const { recipient } = await searchParams;
  if (recipient && /^[1-9]\d{0,24}$/.test(recipient))
    redirect(`/app/creators/${recipient}`);
  return <CreatorFees />;
}
