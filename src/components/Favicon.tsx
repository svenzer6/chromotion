import { memo, useState } from 'react';

/**
 * Chrome's own favicon cache (the "favicon" permission) — works for stored
 * tabs too and never makes a network request.
 */
const faviconUrl = (pageUrl: string) => {
  const u = new URL(chrome.runtime.getURL('/_favicon/'));
  u.searchParams.set('pageUrl', pageUrl);
  u.searchParams.set('size', '32');
  return u.toString();
};

export const Favicon = memo(function Favicon({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  if (failed || !url) {
    return (
      <svg className="favicon" viewBox="0 0 16 16" aria-hidden="true">
        <rect width="16" height="16" rx="4" fill="currentColor" opacity="0.14" />
      </svg>
    );
  }
  return <img className="favicon" src={faviconUrl(url)} alt="" loading="lazy" onError={() => setFailed(true)} />;
});
