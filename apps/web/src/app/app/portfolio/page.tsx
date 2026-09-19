import { Portfolio } from "@/components/launchpad/portfolio";
export const metadata = {
  title: "Your wallet",
  alternates: { canonical: "https://app.oneonly.lol/app/portfolio" },
};
export default function Page() {
  return <Portfolio />;
}
