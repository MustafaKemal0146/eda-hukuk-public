// Veri yolu şeması (053-12 §6.4): statik SVG; anlam renkle değil metinle verilir. Aynı bilgi sayfada
// ayrıca düz paragraf olarak yer alır (erişilebilir metin alternatifi).
type Labels = {
  title: string;
  user: string;
  server: string;
  gate: string;
  tls: string;
  publicProvider: string;
  euProvider: string;
  off: string;
};

const LINE_STEP = 16;

function Box({ x, y, w, h, label }: { x: number; y: number; w: number; h: number; label: string }) {
  const lines = label.split(' | ');
  const first = y + h / 2 - ((lines.length - 1) * LINE_STEP) / 2 + 4;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={8} className="fill-surface stroke-border-strong" />
      {lines.map((line, i) => (
        <text
          key={line}
          x={x + w / 2}
          y={first + i * LINE_STEP}
          textAnchor="middle"
          className={`fill-fg text-caption ${i === 0 ? 'font-medium' : ''}`}
        >
          {line}
        </text>
      ))}
    </g>
  );
}

export function TrustDiagram({ labels }: { labels: Labels }) {
  return (
    <svg
      viewBox="0 0 720 320"
      role="img"
      aria-label={labels.title}
      className="h-auto w-full max-w-doc rounded-lg border border-border bg-surface-sunken"
    >
      <title>{labels.title}</title>
      <defs>
        <marker
          id="ok"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="8"
          markerHeight="8"
          orient="auto-start-reverse"
        >
          <path d="M0 0 L10 5 L0 10 z" className="fill-fg-muted" />
        </marker>
      </defs>
      <Box x={20} y={24} w={200} h={64} label={labels.user} />
      <Box x={260} y={24} w={200} h={64} label={labels.server} />
      <Box x={500} y={24} w={200} h={64} label={labels.gate} />
      <g className="stroke-fg-muted" markerEnd="url(#ok)">
        <line x1={220} y1={56} x2={258} y2={56} markerEnd="url(#ok)" />
        <line x1={460} y1={56} x2={498} y2={56} markerEnd="url(#ok)" />
        <line x1={600} y1={88} x2={120} y2={206} markerEnd="url(#ok)" />
        <line x1={600} y1={88} x2={360} y2={206} markerEnd="url(#ok)" />
        <line x1={600} y1={88} x2={600} y2={206} markerEnd="url(#ok)" />
      </g>
      <text x={240} y={46} textAnchor="middle" className="fill-fg-muted text-caption">
        {labels.tls}
      </text>
      <Box x={20} y={210} w={200} h={88} label={labels.publicProvider} />
      <Box x={260} y={210} w={200} h={88} label={labels.euProvider} />
      <Box x={500} y={210} w={200} h={88} label={labels.off} />
    </svg>
  );
}
