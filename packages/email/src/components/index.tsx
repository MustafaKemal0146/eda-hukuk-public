// E-posta bileşenleri (045 §7.1–§7.2): tek sütun, sistem yazı tipleri, gövde >= 16 px, satır aralığı
// >= 1,5, düğme >= 44 px. Uzak görsel, harici yazı tipi ve izleme yoktur; stiller satır içidir.
// Görsel dil ürün arayüzüyle aynıdır: mürekkep siyahı, nötr zemin, serif başlık (Georgia yedekleriyle).
import type { ReactNode } from 'react';

const TEXT = '#18181B';
const BODY = '#3F3F46';
const MUTED = '#63636D';
const LINE = '#E4E4E7';
const SOFT = '#F4F4F5';
const ACCENT = '#18181B';
const FONT = 'system-ui, -apple-system, Roboto, Arial, sans-serif';
const SERIF = 'Georgia, Times, serif';

export function Heading({ children }: { readonly children: ReactNode }) {
  return (
    <h1
      style={{
        fontFamily: SERIF,
        fontSize: '28px',
        lineHeight: 1.3,
        fontWeight: 600,
        color: TEXT,
        margin: '0 0 20px',
      }}
    >
      {children}
    </h1>
  );
}

export function Paragraph({
  children,
  muted = false,
}: {
  readonly children: ReactNode;
  readonly muted?: boolean;
}) {
  return (
    <p
      style={{
        fontFamily: FONT,
        fontSize: muted ? '14px' : '16px',
        lineHeight: 1.6,
        color: muted ? MUTED : BODY,
        margin: '0 0 16px',
      }}
    >
      {children}
    </p>
  );
}

export function KeyValueList({
  items,
}: {
  readonly items: readonly (readonly [string, string])[];
}) {
  return (
    <table
      role="presentation"
      width="100%"
      style={{
        borderCollapse: 'separate',
        borderSpacing: 0,
        margin: '0 0 20px',
        background: SOFT,
        border: `1px solid ${LINE}`,
        borderRadius: '8px',
      }}
    >
      <tbody>
        {items.map(([k, v]) => (
          <tr key={k}>
            <td
              style={{
                fontFamily: FONT,
                fontSize: '16px',
                lineHeight: 1.6,
                color: MUTED,
                padding: '10px 16px 10px 16px',
              }}
            >
              {k}
            </td>
            <td
              style={{
                fontFamily: FONT,
                fontSize: '16px',
                lineHeight: 1.6,
                color: TEXT,
                fontWeight: 600,
                padding: '10px 16px 10px 0',
              }}
            >
              {v}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Notice({ children }: { readonly children: ReactNode }) {
  return (
    <p
      style={{
        fontFamily: FONT,
        fontSize: '16px',
        lineHeight: 1.6,
        color: TEXT,
        background: SOFT,
        borderLeft: `4px solid ${ACCENT}`,
        borderRadius: '4px',
        padding: '14px 18px',
        margin: '0 0 20px',
      }}
    >
      {children}
    </p>
  );
}

/** Düğme = bağlantı (en az 44 px); altında aynı bağlantının metin hâli (045 §4.2 madde 2). */
export function Button({ label, href }: { readonly label: string; readonly href: string }) {
  return (
    <>
      <p style={{ margin: '4px 0 20px' }}>
        <a
          href={href}
          style={{
            display: 'inline-block',
            fontFamily: FONT,
            fontSize: '16px',
            fontWeight: 600,
            lineHeight: '48px',
            minHeight: '48px',
            padding: '0 28px',
            color: '#ffffff',
            background: ACCENT,
            borderRadius: '8px',
            textDecoration: 'none',
          }}
        >
          {label}
        </a>
      </p>
      <p
        style={{
          fontFamily: FONT,
          fontSize: '14px',
          lineHeight: 1.6,
          color: MUTED,
          margin: '0 0 16px',
          wordBreak: 'break-all',
        }}
      >
        Düğme çalışmazsa bu adresi tarayıcınıza yapıştırın:{' '}
        <a href={href} style={{ color: ACCENT }}>
          {href}
        </a>
      </p>
    </>
  );
}

export function PathLink({ label, href }: { readonly label: string; readonly href: string }) {
  return (
    <p style={{ fontFamily: FONT, fontSize: '16px', lineHeight: 1.6, margin: '0 0 16px' }}>
      <a href={href} style={{ color: ACCENT }}>
        {label}
      </a>
    </p>
  );
}
