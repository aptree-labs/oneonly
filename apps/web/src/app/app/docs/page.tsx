import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { guides } from "@/lib/docs-content";

export default function DocsPage() {
  return (
    <>
      <header className="lp-docs-intro">
        <span className="lp-kicker">THE ONE ONLY FIELD GUIDE</span>
        <h1>
          One ticker.
          <br />
          <em>Less second-guessing.</em>
        </h1>
        <p>
          You called the narrative. Finding its token should be clearer. Learn
          why One Only exists, then find your way from ticker to live market.
        </p>
        <Link className="lp-docs-start" href="/app/docs/why-one-only">
          Start with why <ArrowRight size={19} />
        </Link>
      </header>
      <section className="lp-docs-directory" aria-labelledby="docs-guides">
        <h2 id="docs-guides">Get to know One Only</h2>
        <div>
          {guides.map((guide) => (
            <Link
              className="lp-docs-guide"
              key={guide.slug}
              href={`/app/docs/${guide.slug}`}
            >
              <div>
                <h3>{guide.title}</h3>
                <p>{guide.description}</p>
              </div>
              <ArrowUpRight size={23} aria-hidden="true" />
            </Link>
          ))}
        </div>
      </section>
      <div className="lp-docs-endnote">
        <span>Ready to explore?</span>
        <Link href="/app">
          Find a token <ArrowRight size={17} />
        </Link>
      </div>
    </>
  );
}
