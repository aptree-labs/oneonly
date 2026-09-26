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
  return (
    <CreatorFees
      recipient={recipient && /^\d+$/.test(recipient) ? recipient : undefined}
    />
  );
}
