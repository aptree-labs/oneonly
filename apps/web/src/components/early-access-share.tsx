"use client";

import { useEffect, useRef } from "react";
import {
  earlyAccessShare,
  earlyAccessShareIntent,
} from "@/lib/early-access-share";

export function EarlyAccessShareImage() {
  return (
    <img
      className="share-art"
      src="/brand/early-access-share-v1-768.webp"
      srcSet="/brand/early-access-share-v1-384.webp 384w, /brand/early-access-share-v1-768.webp 768w"
      sizes="(max-width: 600px) 85vw, 420px"
      width="1024"
      height="1024"
      alt={earlyAccessShare.imageAlt}
    />
  );
}

export function EarlyAccessShareDialog({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current!;
    const previousFocus = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      if (previousFocus?.isConnected)
        previousFocus.focus({ preventScroll: true });
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="share-dialog"
      aria-labelledby="share-heading"
      aria-describedby="share-description"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const box = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < box.left ||
          event.clientX > box.right ||
          event.clientY < box.top ||
          event.clientY > box.bottom
        )
          onClose();
      }}
    >
      <button
        className="share-close"
        aria-label="Close share popup"
        onClick={onClose}
        autoFocus
      >
        ×
      </button>
      <p className="eyebrow">YOU’RE ON THE LIST</p>
      <h2 id="share-heading">Let them know.</h2>
      <EarlyAccessShareImage />
      <p className="share-caption">{earlyAccessShare.text}</p>
      <a
        className="primary-button share-x"
        href={earlyAccessShareIntent}
        target="_blank"
        rel="noopener noreferrer"
      >
        Share on X <span aria-hidden="true">↗</span>
      </a>
      <p id="share-description" className="share-note">
        Opens an X draft with this caption and an image-preview link.
      </p>
      <a
        className="share-download"
        href={earlyAccessShare.image}
        download="oneonly-early-access.jpg"
      >
        Download image to attach
      </a>
    </dialog>
  );
}
