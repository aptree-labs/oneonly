import { Portfolio } from "@/components/launchpad/portfolio";
export const metadata = {
  title: "Your wallet",
  alternates: { canonical: "https://oneonly.lol/app/portfolio" },
};
export default function Page() {
  return <Portfolio />;
}
