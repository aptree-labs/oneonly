export type Guide = {
  slug: string;
  title: string;
  description: string;
  sections: {
    id: string;
    title: string;
    paragraphs: string[];
    bullets?: string[];
  }[];
};

export const guides: Guide[] = [
  {
    slug: "why-one-only",
    title: "Why One Only",
    description:
      "Calling the narrative should not mean guessing between copies.",
    sections: [
      {
        id: "the-problem",
        title: "Right narrative. Which ticker?",
        paragraphs: [
          "You spot the story early: a big game, a cultural moment, a meme everyone is starting to share. Then you search its ticker and find a crowd of identical-looking tokens. Recognizing the narrative is one decision. Picking the contract that people gather around becomes another.",
          "One Only is being built to remove that second guessing game inside the platform. One active ticker claim gives people a shared place to discover the token, follow its market, and join its conversation. Attention does not have to split across competing copies of the same ticker on One Only.",
        ],
      },
      {
        id: "one-registry",
        title: "One active claim, across pairs",
        paragraphs: [
          "Ticker availability is shared across One Only. Changing the pairing asset does not create a second claim on the same active ticker. Symbols are normalized before availability is checked.",
          "This rule applies inside One Only. It does not stop someone minting a token with the same name elsewhere on Solana. The contract address is still the identifier to check before trading.",
        ],
      },
      {
        id: "pairing",
        title: "The same ticker, more ways to participate",
        paragraphs: [
          "The choice of pairing asset should serve the community. One Only supports configured pairs across SOL, stablecoins, DeFi tokens, and tokenized stocks. The launch form shows which assets are currently available.",
          "When trading, choose what you want to pay or receive and let the app look for a supported route. The pairing asset changes the market’s denomination; it does not create another claim on the ticker. A stock-token pair does not turn the launched token into shares of that company.",
        ],
      },
      {
        id: "room-to-build",
        title: "A launch can start with an idea",
        paragraphs: [
          "Creators choose a ticker, an image, and a supported pairing asset. They can add a story and project links, and decide whether to include a first buy. Anyone can make the first purchase after launch.",
          "Tokens begin trading on a Meteora bonding curve. When a pool reaches its configured threshold, it can graduate into Meteora DAMM v2. The launch and the market share the same path from the beginning.",
        ],
      },
      {
        id: "active-names",
        title: "Names stay with active communities",
        paragraphs: [
          "A ticker can be released when every pool under it has less than $100 of daily trading volume for 30 complete UTC days, once the app has enough verified history to apply that rule.",
          "Releasing a ticker does not erase the old token, your balance, or its trading history. Always check the contract address when returning to a ticker that may have been claimed again.",
          "Clearer discovery is the goal. A unique ticker does not guarantee demand, liquidity, or a profitable trade.",
        ],
      },
    ],
  },
  {
    slug: "oneonly-token",
    title: "$ONEONLY",
    description: "Real revenue. Open-market buybacks. Permanent burns.",
    sections: [
      {
        id: "why-it-exists",
        title: "Revenue needs somewhere honest to go",
        paragraphs: [
          "Most platform tokens exist because a whitepaper said they should. $ONEONLY exists because the platform generates real revenue, and real revenue needs somewhere honest to go.",
        ],
      },
      {
        id: "fee-allocation",
        title: "How $ONEONLY trades fund buybacks",
        paragraphs: [
          "Trades in the $ONEONLY platform token carry a 1.25% trading fee. Its creator’s share is allocated to $ONEONLY buybacks.",
        ],
        bullets: [
          "0.25% goes to Meteora, the infrastructure One Only is built on.",
          "0.5% is the $ONEONLY creator’s share, dedicated to buying back $ONEONLY.",
          "0.5% goes to platform revenue.",
        ],
      },
      {
        id: "buyback-and-burn",
        title: "Bought back. Burned permanently.",
        paragraphs: [
          "The creator-fee revenue allocated to buybacks is used to buy $ONEONLY on the open market. Every $ONEONLY token bought back under this program is burned, permanently removing it from supply once the burn transaction is confirmed.",
          "Each completed burn reduces the token supply.",
        ],
      },
    ],
  },
  {
    slug: "launch-a-token",
    title: "Launch a token",
    description: "Claim an available ticker and choose how it starts.",
    sections: [
      {
        id: "prepare",
        title: "Choose your ticker",
        paragraphs: [
          "Open Launch a token, add an image and name, then enter a ticker. The form checks availability. Tickers use 1–10 letters or numbers; a leading $ is not part of the symbol.",
        ],
        bullets: [
          "Choose one of the pairing assets currently enabled in the form.",
          "Add a story, website, or social links if you want. These are optional.",
          "You can paste an X link or use a verified account you have linked to your wallet. A pasted link alone is not verification.",
        ],
      },
      {
        id: "first-buy",
        title: "The first buy is optional",
        paragraphs: [
          "You do not have to buy your own token to launch it. Leave the first-buy option off to create the token without purchasing an allocation. Another trader can buy first.",
          "If you include a first buy, the form shows the applicable minimum and payment options. A conversion into the pairing asset may require an additional step. Review each transaction before approving it.",
        ],
      },
      {
        id: "approve",
        title: "Review and launch",
        paragraphs: [
          "Connect your wallet and review the launch details. Your wallet shows the transaction for approval. Creating a token still requires SOL for network fees and account rent, even when you skip the first buy.",
          "Wait for confirmation before treating the launch as complete. Once confirmed, open the token page and copy its contract address to share the right token with your community.",
        ],
      },
      {
        id: "supply",
        title: "What gets created",
        paragraphs: [
          "One Only launches use a fixed supply of 1 billion tokens. The pool starts on Meteora’s Dynamic Bonding Curve, with the pairing asset and graduation threshold set by its configuration.",
          "The token program and configuration belong to that launch. A later platform configuration change does not rewrite an existing token or pool.",
        ],
      },
    ],
  },
  {
    slug: "buy-and-sell",
    title: "Buy & sell",
    description:
      "Choose what you pay or receive. Review the quote. Confirm in your wallet.",
    sections: [
      {
        id: "find",
        title: "Find the right token",
        paragraphs: [
          "Search Explore by name, ticker, or contract address. Open the token page to see its market, chart, story, and trading activity. You can copy the contract address from the listing card or token page.",
        ],
      },
      {
        id: "assets",
        title: "Pick your payment or receive asset",
        paragraphs: [
          "On Buy, choose the asset you want to pay with. On Sell, choose the asset you want to receive. Enter an amount or use a balance percentage. The app looks for an available route for your selection.",
          "A route may pass through another asset. Availability depends on the token’s pools, supported assets, and current liquidity. An asset appearing in the selector does not guarantee a quote for every amount.",
        ],
      },
      {
        id: "quote",
        title: "Read the quote",
        paragraphs: [
          "The receive amount updates as a quote becomes available. An estimate can change before the trade is submitted.",
        ],
        bullets: [
          "Maximum input is the most the swap may spend from your selected input asset. SOL network fees and account rent are additional.",
          "Minimum received is the lower output bound used by the trade. Slippage tolerance determines how far the execution can move from the quote.",
          "Keep some SOL for transaction fees even when paying with a different token.",
        ],
      },
      {
        id: "confirmation",
        title: "Approve, then wait for confirmation",
        paragraphs: [
          "Approve the transaction in your wallet. The app reports confirmation and clears the trade inputs after a successful trade. You can then save or share the purchase or sale card.",
          "If approval expires or the quote becomes unavailable, request a fresh quote. If a transaction was already submitted, check its status or explorer link before trying again.",
        ],
      },
      {
        id: "chart",
        title: "Choose how to view the chart",
        paragraphs: [
          "Use the chart’s pricing selector to switch between USD and the pairing asset. When historical USD prices are unavailable, the pairing asset can still show the recorded trade prices.",
          "A new token may have little or no trade history. The chart uses recorded trades and can take a moment to catch up after confirmation. Market cap is a valuation based on price and supply; it is not the amount of money you can withdraw.",
        ],
      },
    ],
  },
  {
    slug: "fees-and-graduation",
    title: "Fees & graduation",
    description:
      "Understand trading costs and the move from curve to liquidity pool.",
    sections: [
      {
        id: "fees",
        title: "Trading on the curve",
        paragraphs: [
          "The published curve trading fee is 1.25%. The creator earns 0.5% of curve trading volume. These trading fees are separate from Solana network fees and any account rent required by the transaction.",
          "For the $ONEONLY platform token, its creator’s share funds open-market $ONEONLY buybacks and permanent burns.",
          "An additional asset conversion can have its own fees and price impact. Check the route and transaction details for the trade you are making.",
        ],
      },
      {
        id: "curve",
        title: "How the bonding curve works",
        paragraphs: [
          "One Only uses Meteora’s Dynamic Bonding Curve. A configured price curve determines how token purchases and sales change the price as reserves change. Buying and selling can move the price; the chart is a record of trading, not a promised return.",
          "The curve uses virtual liquidity at launch and accumulates real pairing-asset reserves through trading. Its configuration sets the graduation threshold.",
        ],
      },
      {
        id: "graduation",
        title: "When a token graduates",
        paragraphs: [
          "Graduation becomes available when the pool reaches its configured reserve threshold. The progress shown on the token page tracks that threshold. It is measured in the pool’s pairing asset, so its dollar value can move as that asset’s price changes.",
          "Once eligible, migration must be completed on-chain. The token then trades in a Meteora DAMM v2 pool. Reaching 100% is eligibility for that transition, rather than a guarantee that the migration transaction has already completed.",
        ],
      },
      {
        id: "creator-fees",
        title: "Claiming creator fees",
        paragraphs: [
          "Connect the wallet that created the token to see available creator fees on its page. Claiming requires a wallet-approved transaction and enough SOL for network fees.",
          "Curve fees and fees earned after graduation belong to different stages. The app shows the available claim for the pool’s stage. Its on-chain configuration determines the fee and liquidity rules; the creator cannot edit those rules from the claim button.",
        ],
      },
    ],
  },
  {
    slug: "wallet-and-community",
    title: "Your wallet & community",
    description:
      "Find your holdings, join the conversation, and share a trade.",
    sections: [
      {
        id: "wallet",
        title: "Your ones, in one place",
        paragraphs: [
          "Your wallet shows token holdings first, followed by quote-asset balances, your launches, and transaction history. With a connected wallet and a valid sign-in session, it loads automatically.",
          "If your session has expired, sign a message to confirm wallet ownership. Signing in does not authorize a transaction. Purchases, sales, launches, and fee claims require their own wallet approval.",
        ],
      },
      {
        id: "comments",
        title: "Join the conversation",
        paragraphs: [
          "The comments on a token page are for traders with a verified purchase of that token. Connect and sign in with the wallet you used to buy, then use the composer to post.",
          "When you link an X account through Connect X, its verified profile can appear with your comments. Adding a social URL to a token’s project links is separate from linking your own identity.",
        ],
      },
      {
        id: "share",
        title: "Share a confirmed trade",
        paragraphs: [
          "A successful buy or sell can open a share card for that ticker. Sharing opens a draft for you to review; One Only does not publish it to X automatically.",
          "Sale profit-and-loss details depend on the purchase history available to the app. A transferred token or incomplete cost history may not have a reliable cost basis. Treat the card as trade context, not a complete wallet accounting report.",
        ],
      },
    ],
  },
];
