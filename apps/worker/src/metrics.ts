// Süreç içi Prometheus metrikleri (043 §14.1; tam set P30). Etiketlerde kimlik yoktur (iş adı, kuyruk
// gibi kapalı kümeler). Metin biçimi 0.0.4.

export const METRIC_DEFS = {
  eda_audit_seal_mismatch_total: {
    type: 'counter',
    help: 'Denetim mührü doğrulama uyuşmazlıkları',
  },
  eda_job_skipped_stale_total: {
    type: 'counter',
    help: 'Bayat zamanlayıcı tiki nedeniyle atlanan işler',
  },
  eda_email_sent_total: { type: 'counter', help: 'Gönderilen e-postalar (şablon, sınıf)' },
  eda_email_failed_total: {
    type: 'counter',
    help: 'Kalıcı başarısız e-postalar (şablon, sınıf, hata kodu)',
  },
  eda_email_suppressed_total: { type: 'counter', help: 'Bastırılan e-postalar (neden)' },
  eda_email_requeued_total: {
    type: 'counter',
    help: 'email_outbox.sweep ile yeniden kuyruğa alınan teslimatlar',
  },
  eda_file_scan_total: { type: 'counter', help: 'file.scan sonuçları (outcome)' },
  eda_file_extract_total: { type: 'counter', help: 'file.extract sonuçları (outcome)' },
  eda_file_scan_skipped_total: {
    type: 'counter',
    help: 'CLAMAV_ENABLED=false (yalnız dev/test) nedeniyle taranmadan geçen evrak',
  },
  eda_file_integrity_failures_total: {
    type: 'counter',
    help: 'AEAD/bütünlük doğrulaması başarısız evrak okumaları',
  },
  eda_clamav_db_age_hours: { type: 'gauge', help: 'ClamAV imza veritabanı yaşı (saat)' },
  eda_source_canary_ok: {
    type: 'gauge',
    help: 'Son kaynak kanaryası sonucu (kaynak başına 1 başarılı / 0 başarısız; 074)',
  },
  eda_backup_last_verify_success_timestamp: {
    type: 'gauge',
    help: 'Son başarılı pgBackRest doğrulamasının zamanı (Unix saniye; backup.verify)',
  },
  eda_scheduler_last_run_timestamp: {
    type: 'gauge',
    help: 'Zamanlanmış işin son başlama zamanı (Unix saniye)',
  },
} as const;

export type MetricName = keyof typeof METRIC_DEFS;
export type MetricLabels = Readonly<Record<string, string>>;

function labelKey(labels: MetricLabels | undefined): string {
  if (labels === undefined) return '';
  const parts = Object.keys(labels)
    .sort()
    .map((k) => `${k}="${(labels[k] ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
  return parts.length > 0 ? `{${parts.join(',')}}` : '';
}

export class Metrics {
  private readonly values = new Map<MetricName, Map<string, number>>();

  inc(name: MetricName, labels?: MetricLabels, by = 1): void {
    const series = this.series(name);
    const key = labelKey(labels);
    series.set(key, (series.get(key) ?? 0) + by);
  }

  set(name: MetricName, value: number, labels?: MetricLabels): void {
    this.series(name).set(labelKey(labels), value);
  }

  get(name: MetricName, labels?: MetricLabels): number {
    return this.values.get(name)?.get(labelKey(labels)) ?? 0;
  }

  /** Prometheus metin biçimi; sayaçlar hiç artmasa da 0 ile yayınlanır. */
  render(): string {
    const lines: string[] = [];
    for (const name of Object.keys(METRIC_DEFS) as MetricName[]) {
      const def = METRIC_DEFS[name];
      lines.push(`# HELP ${name} ${def.help}`, `# TYPE ${name} ${def.type}`);
      const series = this.values.get(name);
      if (series === undefined || series.size === 0) {
        if (def.type === 'counter') lines.push(`${name} 0`);
        continue;
      }
      for (const [key, value] of series) lines.push(`${name}${key} ${value}`);
    }
    return `${lines.join('\n')}\n`;
  }

  private series(name: MetricName): Map<string, number> {
    let series = this.values.get(name);
    if (series === undefined) {
      series = new Map();
      this.values.set(name, series);
    }
    return series;
  }
}
