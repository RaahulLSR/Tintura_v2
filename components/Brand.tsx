import React from 'react';

// =====================================================================
// TINTURA brand marks for the app UI — a crisp vector recreation of the
// "• TINTURA® •  CASUALS" logo banner (white wordmark on a near-black badge
// with amber accent dots). Colours are hard-coded so the mark stays faithful
// regardless of the app's indigo theme. Scale is driven by font-size, so set
// the size via a Tailwind text-* class on `className`.
// =====================================================================

const INK = '#0b0b0c';   // near-black badge
const AMBER = '#f5a623'; // accent dots

interface LogoProps {
  /** Tailwind text-size class controls the overall scale (e.g. "text-base"). */
  className?: string;
  /** Letter-spaced caption under the wordmark. Defaults to "CASUALS". */
  subtitle?: string;
  /** Render the white wordmark with no black badge — for dark/coloured panels. */
  onDark?: boolean;
}

const Dot: React.FC = () => (
  <span
    className="inline-block rounded-full shrink-0"
    style={{ width: '0.32em', height: '0.32em', background: AMBER }}
  />
);

/** Horizontal TINTURA logo lockup with amber accent dots + CASUALS caption. */
export const TinturaLogo: React.FC<LogoProps> = ({
  className = 'text-base',
  subtitle = 'CASUALS',
  onDark = false,
}) => (
  <span className={`inline-flex flex-col items-center leading-none ${className}`}>
    <span
      className="inline-flex items-center rounded-md"
      style={onDark ? undefined : { background: INK, padding: '0.34em 0.72em' }}
    >
      <Dot />
      <span
        className="font-extrabold"
        style={{ color: '#fff', letterSpacing: '0.18em', marginLeft: '0.5em', marginRight: '-0.18em' }}
      >
        TINTURA
      </span>
      <sup style={{ color: '#fff', fontSize: '0.5em', fontWeight: 700 }}>&reg;</sup>
      <span className="inline-flex" style={{ marginLeft: '0.45em' }}>
        <Dot />
      </span>
    </span>
    {subtitle && (
      <span
        className="font-bold"
        style={{
          fontSize: '0.4em',
          letterSpacing: '0.5em',
          marginTop: '0.6em',
          paddingLeft: '0.5em',
          color: onDark ? 'rgba(255,255,255,0.75)' : '#64748b',
        }}
      >
        {subtitle}
      </span>
    )}
  </span>
);

/** Round "CASUALS" seal — a compact brand sticker for hero/branding spots. */
export const TinturaSeal: React.FC<{ size?: number; label?: string; className?: string; inverse?: boolean }> = ({
  size = 56,
  label = 'CASUALS',
  className = '',
  inverse = false,
}) => (
  <span
    className={`inline-flex flex-col items-center justify-center rounded-full ${className}`}
    style={{
      width: size,
      height: size,
      background: inverse ? '#ffffff' : INK,
      border: `3px solid ${AMBER}`,
      boxShadow: inverse ? '0 8px 24px rgba(0,0,0,0.25)' : undefined,
    }}
  >
    <span
      className="font-extrabold leading-none"
      style={{ color: inverse ? INK : '#fff', fontSize: size * 0.2, letterSpacing: 1 }}
    >
      TINTURA
    </span>
    <span
      className="font-bold leading-none mt-0.5"
      style={{ color: inverse ? '#b06f08' : AMBER, fontSize: size * 0.13, letterSpacing: 2 }}
    >
      {label}
    </span>
  </span>
);
