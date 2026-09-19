export const earlyAccessShare = {
  text: "r*tarded memefi era",
  url: "https://oneonly.lol/early-access/share",
  image: "/brand/early-access-share-v1.jpg",
  preview: "/brand/early-access-share-v1-og.jpg",
  imageAlt: "A reclining green degen beneath the OneOnly.lol Early Access sign",
};

export const earlyAccessShareIntent = `https://x.com/intent/tweet?${new URLSearchParams(
  {
    text: earlyAccessShare.text,
    url: earlyAccessShare.url,
  },
)}`;
