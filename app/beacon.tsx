'use client';

import { useEffect, type ReactNode } from 'react';
import { signal } from '../lib/beacon';

/** Counts a visit on whichever page a browser session opens first (the layout renders it on every page). */
export function VisitBeacon() {
  useEffect(() => {
    signal('visit');
  }, []);
  return null;
}

/** A Buy link to the Stripe Payment Link that counts the click; renders nothing when no link is configured. */
export function BuyButton({ href, className, children }: { href: string | null; className?: string; children: ReactNode }) {
  if (!href) return null;
  return (
    <a
      className={className}
      href={href}
      onClick={() => signal('checkout')}
      // A middle click opens checkout in a new tab and fires no click event.
      onAuxClick={(event) => {
        if (event.button === 1) signal('checkout');
      }}
    >
      {children}
    </a>
  );
}
