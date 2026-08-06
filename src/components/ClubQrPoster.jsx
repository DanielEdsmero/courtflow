import React, { useState } from 'react';
import QRCode from 'react-qr-code';
import { Copy, Check, ExternalLink, Printer } from 'lucide-react';
import { qrPoster } from '../copy';

/* ─────────────────────────────────────────────
   CLUB QR POSTER (spec §F4)
   The printable half of the display link. Points at /queue/<slug> — the public,
   never-rotating club URL — rather than /d/<token>, so a poster on the wall
   keeps working after staff regenerate the TV link.

   The QR itself is rendered black-on-white against the app's dark theme on
   purpose: scanners cope badly with inverted codes, and this is the one thing on
   screen that has to survive being photographed across a room.
   ───────────────────────────────────────────── */
export default function ClubQrPoster({ venueName, slug }) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/queue/${slug}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      return; // clipboard is blocked outside HTTPS; the URL is on screen to type
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    /* cf-print is what the @media print block in index.css promotes to a full
       black-on-white page — everything else on screen is hidden. */
    <div className="cf-print">
      <div className="flex flex-col sm:flex-row items-center gap-4">
        <div className="bg-white rounded-xl p-3 shrink-0">
          {/* Renders an SVG, so it stays crisp at any print size. */}
          <QRCode value={url} size={148} bgColor="#ffffff" fgColor="#000000" />
        </div>

        <div className="min-w-0 flex-1 text-center sm:text-left">
          <div className="font-display text-2xl leading-tight mb-0.5">{venueName}</div>
          <div className="text-zinc-400 text-sm font-semibold tracking-wide mb-2">
            {qrPoster.scanLine}
          </div>
          <code className="text-lime-400 text-xs break-all leading-relaxed">{url}</code>
        </div>
      </div>

      <div className="cf-print-hide flex flex-col sm:flex-row gap-2 mt-3">
        <button
          onClick={copy}
          className="flex-1 bg-lime-400 hover:bg-lime-300 text-zinc-950 font-bold py-2 rounded-lg flex items-center justify-center gap-2 transition"
        >
          {copied
            ? <><Check className="w-4 h-4" /> {qrPoster.copied}</>
            : <><Copy className="w-4 h-4" /> {qrPoster.copy}</>}
        </button>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-semibold py-2 rounded-lg flex items-center justify-center gap-2 transition"
        >
          <ExternalLink className="w-4 h-4" /> {qrPoster.open}
        </a>
        <button
          onClick={() => window.print()}
          className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-semibold py-2 rounded-lg flex items-center justify-center gap-2 transition"
        >
          <Printer className="w-4 h-4" /> {qrPoster.print}
        </button>
      </div>
    </div>
  );
}
