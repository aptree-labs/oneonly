import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, MessageCircle, ArrowUpRight } from "lucide-react";
import { supportUrl } from "@/lib/support";
import "./docs.css";

export const metadata: Metadata = {
  title: "Docs",
  description:
    "Learn how One Only works: tickers, launches, trading, fees, and graduation.",
};

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="lp-docs">
      <div className="lp-docs-topline">
        <Link href="/app/docs">
          <BookOpen size={17} /> One Only docs
        </Link>
        <a href={supportUrl} target="_blank" rel="noopener noreferrer">
          <MessageCircle size={17} /> Telegram support{" "}
          <ArrowUpRight size={15} />
        </a>
      </div>
      {children}
    </div>
  );
}
