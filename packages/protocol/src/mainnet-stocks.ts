/** Verified against https://api.xstocks.fi/api/v2/public/assets/{symbol}
 * and Solana mainnet on 2026-09-13. DBC badges exist for all five mints.
 * These are catalog entries, not a claim that the scaled-balance adapter is complete.
 * setupThreshold is a proposed fixed UNscaled token quantity for owner review.
 * Rounded up near $10k using DEX Screener spot references on 2026-09-13
 * (SPYx 764.83, QQQx 711.067, NVDAx 215.079, TSLAx 364.065, CRCLx 89.94).
 * It is not a USD peg. The setup review shows the live scaled equivalent.
 */
export const MAINNET_STOCKS = [
  {
    symbol: "SPYX",
    name: "SP500 xStock",
    mint: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W",
    decimals: 8,
    setupThreshold: 14,
    badge: "D2THzeQLHaDeKBzzmTNuWEWw23WPM8vVhLvUmSPEpNeL",
  },
  {
    symbol: "QQQX",
    name: "Nasdaq xStock",
    mint: "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ",
    decimals: 8,
    setupThreshold: 15,
    badge: "6nenkWN8CPvKLoqZTf5CFpkGq6PcR5i7KvLcmbCS5RoE",
  },
  {
    symbol: "NVDAX",
    name: "NVIDIA xStock",
    mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
    decimals: 8,
    setupThreshold: 47,
    badge: "mfacWnGh1Kn5ttHMMaNZhRZbCjvGrDQyDyZgqaR9vBM",
  },
  {
    symbol: "TSLAX",
    name: "Tesla xStock",
    mint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
    decimals: 8,
    setupThreshold: 28,
    badge: "XhM8atXDua58KZnZFLu5vJjzaNWjXaEvpPPEVnHn1ax",
  },
  {
    symbol: "CRCLX",
    name: "Circle xStock",
    mint: "XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1",
    decimals: 8,
    setupThreshold: 112,
    badge: "5X9x9v77jBh2HjTZ1bGY2jtzF5e4ZzfeRzdH3BNKzYfB",
  },
] as const;
