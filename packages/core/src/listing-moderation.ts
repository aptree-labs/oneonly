/** Explicit production listing moderation; preserves token, trade and ownership records. */
export const HIDDEN_MAINNET_TOKEN_IDS = [
  // ONLYONE brand impersonation, removed at the platform owner's request.
  "43eb82db-c9e1-41b3-906c-59f6b080caa6",
  // Delisted at the platform owner's request; history and fee rights remain intact.
  "efb2ee5f-98e1-48d6-b898-b39708314066", // X
  "2bcf58cb-c762-43d0-bb69-036fe0b79cd1", // FRIENDZY
  "69b7002f-fd9e-473d-9dbb-5e93f0ea0152", // ONEPHANTOM
] as const;
