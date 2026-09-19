import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { guides } from "@/lib/docs-content";

type Props = { params: Promise<{ slug: string }> };
export function generateStaticParams() {
  return guides.map(({ slug }) => ({ slug }));
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const guide = guides.find((item) => item.slug === slug);
  if (!guide) notFound();
  return { title: `${guide.title} — Docs`, description: guide.description };
}
export default async function GuidePage({ params }: Props) {
  const { slug } = await params;
  const index = guides.findIndex((item) => item.slug === slug);
  if (index < 0) notFound();
  const guide = guides[index];
  const next = guides[index + 1];
  return (
    <>
      <header className="lp-docs-heading">
        <Link href="/app/docs" className="lp-docs-back">
          <ArrowLeft size={16} /> All guides
        </Link>
        <h1>{guide.title}</h1>
        <p>{guide.description}</p>
      </header>
      <div className="lp-docs-reading">
        <aside className="lp-docs-contents">
          <nav aria-label="Documentation guides">
            <span className="lp-kicker">GUIDES</span>
            {guides.map((item) => (
              <Link
                key={item.slug}
                href={`/app/docs/${item.slug}`}
                aria-current={item.slug === slug ? "page" : undefined}
              >
                {item.title}
              </Link>
            ))}
          </nav>
          <nav aria-label="On this page">
            <span className="lp-kicker">ON THIS PAGE</span>
            {guide.sections.map((section) => (
              <a key={section.id} href={`#${section.id}`}>
                {section.title}
              </a>
            ))}
          </nav>
        </aside>
        <article className="lp-docs-article" aria-label={guide.title}>
          {guide.sections.map((section) => (
            <section id={section.id} key={section.id}>
              <h2>{section.title}</h2>
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
              {section.bullets && (
                <ul>
                  {section.bullets.map((bullet) => (
                    <li key={bullet}>{bullet}</li>
                  ))}
                </ul>
              )}
            </section>
          ))}
          <div className="lp-docs-next">
            {next ? (
              <Link href={`/app/docs/${next.slug}`}>
                <span>
                  Next guide<strong>{next.title}</strong>
                </span>
                <ArrowRight size={21} />
              </Link>
            ) : (
              <Link href="/app">
                <span>
                  Put it into practice<strong>Explore One Only</strong>
                </span>
                <ArrowRight size={21} />
              </Link>
            )}
          </div>
        </article>
      </div>
    </>
  );
}
