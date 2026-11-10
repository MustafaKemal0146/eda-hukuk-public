// Ortak yerleşim (045 §7.2): 600 px tek sütun, `lang="tr"`, tek `h1`, alt bilgi. Logo metin başlıktır.
// `security` sınıfında alt bilgiye kimlik avı uyarısı eklenir; bağlantı yoktur.

import { PRODUCT_NAME } from './brand.ts';
import { Button, Heading, KeyValueList, Notice, Paragraph, PathLink } from './components/index.tsx';
import { type Block, type EmailContent, FOOTER, greeting, SECURITY_FOOTER } from './content.ts';

function BlockView({ block }: { readonly block: Block }) {
  switch (block.kind) {
    case 'paragraph':
      return <Paragraph>{block.text}</Paragraph>;
    case 'keyValue':
      return <KeyValueList items={block.items} />;
    case 'notice':
      return <Notice>{block.text}</Notice>;
    case 'button':
      return <Button label={block.label} href={block.href} />;
    case 'link':
      return <PathLink label={block.label} href={block.href} />;
  }
}

const INK = '#18181B';
const FONT = 'system-ui, -apple-system, Roboto, Arial, sans-serif';
const SERIF = 'Georgia, Times, serif';

export function EmailLayout({
  content,
  subject,
  companyName,
}: {
  readonly content: EmailContent;
  readonly subject: string;
  readonly companyName: string | null;
}) {
  return (
    <html lang="tr">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light" />
        <title>{subject}</title>
      </head>
      <body style={{ margin: 0, padding: 0, background: '#F4F4F5' }}>
        <table
          role="presentation"
          width="100%"
          style={{ borderCollapse: 'collapse', background: '#F4F4F5' }}
        >
          <tbody>
            <tr>
              <td align="center" style={{ padding: '32px 16px' }}>
                <table
                  role="presentation"
                  width="600"
                  style={{
                    borderCollapse: 'separate',
                    borderSpacing: 0,
                    maxWidth: '600px',
                    width: '100%',
                    background: '#ffffff',
                    border: '1px solid #E4E4E7',
                    borderRadius: '12px',
                    overflow: 'hidden',
                  }}
                >
                  <tbody>
                    <tr>
                      <td style={{ background: INK, padding: '22px 32px' }}>
                        <table role="presentation" style={{ borderCollapse: 'collapse' }}>
                          <tbody>
                            <tr>
                              <td
                                style={{
                                  width: '36px',
                                  height: '36px',
                                  background: '#F4F4F5',
                                  borderRadius: '8px',
                                  textAlign: 'center',
                                  fontFamily: SERIF,
                                  fontSize: '22px',
                                  fontWeight: 600,
                                  color: INK,
                                  lineHeight: '36px',
                                }}
                              >
                                §
                              </td>
                              <td
                                style={{
                                  padding: '0 0 0 12px',
                                  fontFamily: SERIF,
                                  fontSize: '22px',
                                  fontWeight: 600,
                                  color: '#ffffff',
                                  letterSpacing: '-0.2px',
                                }}
                              >
                                {PRODUCT_NAME}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </td>
                    </tr>
                    <tr>
                      <td style={{ padding: '36px 32px 12px' }}>
                        <Heading>{content.heading}</Heading>
                        <Paragraph>{greeting(content.greetingName)}</Paragraph>
                        {content.blocks.map((b, i) => (
                          <BlockView key={i} block={b} />
                        ))}
                      </td>
                    </tr>
                    <tr>
                      <td
                        style={{
                          padding: '20px 32px 8px',
                          borderTop: '1px solid #E4E4E7',
                          background: '#FAFAFA',
                          fontFamily: FONT,
                        }}
                      >
                        <Paragraph muted>{content.footer ?? FOOTER}</Paragraph>
                        {content.class === 'security' ? (
                          <Paragraph muted>{SECURITY_FOOTER}</Paragraph>
                        ) : null}
                        {companyName === null ? null : <Paragraph muted>{companyName}</Paragraph>}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </body>
    </html>
  );
}
