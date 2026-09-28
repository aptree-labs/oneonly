import { TokenDetail } from "@/components/launchpad/token";
import {
  tokenShareTitle,
  tokenShareDescription,
  tokenShareUrl,
} from "@/lib/token-sharing";
import type { Metadata } from "next";
import { tokenRecord, tokenDetail } from "@/lib/launchpad/token-detail";
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  try {
    const token = await tokenRecord(id);
    const title = tokenShareTitle(token.ticker),
      description = tokenShareDescription;
    const url = tokenShareUrl(token.id);
    const image = new URL(
      `/api/launchpad/image/${token.imageId}`,
      url,
    ).toString();
    return {
      title: { absolute: title },
      description,
      alternates: { canonical: url },
      openGraph: {
        type: "website",
        title,
        description,
        url,
        images: [{ url: image, width: 512, height: 512, alt: token.name }],
      },
      twitter: {
        card: "summary",
        title,
        description,
        images: [{ url: image, alt: token.name }],
      },
    };
  } catch {
    return {
      title: "Token",
      alternates: { canonical: `https://oneonly.lol/app/token/${id}` },
    };
  }
}
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const initial = await tokenDetail(id).catch(() => undefined);
  return <TokenDetail key={id} id={id} initial={initial} />;
}
