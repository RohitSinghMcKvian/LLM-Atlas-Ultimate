/**
 * Provider marks.
 *
 * Inline SVG because `lucide-react` carries no brand logos, and because the
 * marks have to survive both themes: Apple and GitHub are drawn in
 * `currentColor` so they flip with the foreground, while Google, Microsoft,
 * GitLab and Discord keep the fixed brand colours their guidelines require.
 *
 * Every path is the vendor's published mark at its own viewBox, scaled by the
 * caller through `className`.
 */

import type { AuthProviderId } from "@/lib/auth/providers";

type IconProps = { className?: string };

function Google({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.63h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.8Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.08 7.94-2.93l-3.88-3c-1.08.72-2.45 1.15-4.06 1.15-3.13 0-5.78-2.11-6.73-4.95H1.26v3.09A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.27a7.2 7.2 0 0 1 0-4.54V6.64H1.26a12 12 0 0 0 0 10.72l4.01-3.09Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.26 6.64l4.01 3.09C6.22 6.89 8.87 4.75 12 4.75Z"
      />
    </svg>
  );
}

function GitHub({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M12 .3a12 12 0 0 0-3.79 23.4c.6.1.82-.26.82-.58v-2.23c-3.34.73-4.04-1.42-4.04-1.42-.55-1.38-1.34-1.75-1.34-1.75-1.09-.75.08-.73.08-.73 1.2.08 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5 1 .1-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.12-3.18 0 0 1-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.28-1.55 3.29-1.23 3.29-1.23.66 1.66.24 2.88.12 3.18.77.84 1.23 1.91 1.23 3.22 0 4.61-2.8 5.62-5.48 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.7.83.58A12 12 0 0 0 12 .3Z" />
    </svg>
  );
}

function Microsoft({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path fill="#F25022" d="M1 1h10.2v10.2H1z" />
      <path fill="#7FBA00" d="M12.8 1H23v10.2H12.8z" />
      <path fill="#00A4EF" d="M1 12.8h10.2V23H1z" />
      <path fill="#FFB900" d="M12.8 12.8H23V23H12.8z" />
    </svg>
  );
}

function Apple({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M17.05 12.72c-.03-2.7 2.2-4 2.3-4.06-1.25-1.83-3.2-2.08-3.9-2.11-1.66-.17-3.24.98-4.08.98-.84 0-2.14-.96-3.52-.93-1.81.03-3.48 1.05-4.41 2.67-1.88 3.26-.48 8.08 1.35 10.72.9 1.29 1.96 2.74 3.36 2.69 1.35-.06 1.86-.87 3.49-.87 1.62 0 2.09.87 3.51.84 1.45-.02 2.37-1.31 3.26-2.61 1.03-1.5 1.45-2.95 1.47-3.02-.03-.02-2.82-1.08-2.85-4.3M14.4 4.6c.74-.9 1.24-2.14 1.1-3.38-1.07.04-2.36.71-3.13 1.6-.68.79-1.28 2.05-1.12 3.26 1.19.09 2.41-.6 3.15-1.48" />
    </svg>
  );
}

function GitLab({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path fill="#E24329" d="m12 22.5 4.42-13.6H7.58L12 22.5Z" />
      <path fill="#FC6D26" d="M12 22.5 7.58 8.9H1.39L12 22.5Z" />
      <path
        fill="#FCA326"
        d="M1.39 8.9.05 13.02a.92.92 0 0 0 .33 1.03L12 22.5 1.39 8.9Z"
      />
      <path fill="#E24329" d="M1.39 8.9h6.19L4.92.72a.46.46 0 0 0-.87 0L1.39 8.9Z" />
      <path fill="#FC6D26" d="m12 22.5 4.42-13.6h6.19L12 22.5Z" />
      <path
        fill="#FCA326"
        d="m22.61 8.9 1.34 4.12a.92.92 0 0 1-.33 1.03L12 22.5 22.61 8.9Z"
      />
      <path fill="#E24329" d="M22.61 8.9h-6.19L19.08.72a.46.46 0 0 1 .87 0L22.61 8.9Z" />
    </svg>
  );
}

function Discord({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="#5865F2" aria-hidden="true">
      <path d="M20.32 4.37A19.8 19.8 0 0 0 15.43 3c-.21.38-.46.89-.63 1.29a18.3 18.3 0 0 0-5.6 0C9.03 3.89 8.77 3.38 8.56 3a19.74 19.74 0 0 0-4.9 1.37C.55 9.05-.3 13.6.13 18.1a19.9 19.9 0 0 0 6.07 3.08c.49-.67.93-1.38 1.3-2.13-.71-.27-1.4-.6-2.04-.99.17-.12.34-.25.5-.38a14.2 14.2 0 0 0 12.07 0c.17.13.33.26.5.38-.65.39-1.33.72-2.05.99.38.75.81 1.46 1.3 2.13a19.87 19.87 0 0 0 6.07-3.08c.5-5.18-.86-9.7-3.53-13.73ZM8.02 15.33c-1.18 0-2.15-1.09-2.15-2.42s.95-2.42 2.15-2.42c1.2 0 2.17 1.09 2.15 2.42 0 1.33-.95 2.42-2.15 2.42Zm7.96 0c-1.18 0-2.15-1.09-2.15-2.42s.95-2.42 2.15-2.42c1.2 0 2.17 1.09 2.15 2.42 0 1.33-.94 2.42-2.15 2.42Z" />
    </svg>
  );
}

const ICONS: Record<AuthProviderId, (p: IconProps) => React.JSX.Element> = {
  google: Google,
  github: GitHub,
  azure: Microsoft,
  apple: Apple,
  gitlab: GitLab,
  discord: Discord,
};

export function ProviderIcon({
  id,
  className,
}: {
  id: AuthProviderId;
  className?: string;
}) {
  const Icon = ICONS[id];
  return Icon ? <Icon className={className} /> : null;
}
