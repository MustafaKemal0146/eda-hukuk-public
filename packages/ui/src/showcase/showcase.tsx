'use client';
// Bileşen vitrini (P05.14; 051 §17, 052 §1.4): her `ready` ilkel, uygulanabilir durumlarıyla. İki bölüm:
// açık tema + rahat yoğunluk ve koyu tema + sıkı yoğunluk (tokenlar alt ağaçta data-theme ile çalışır).
// Tek kaynak: apps/web /_kitchen-sink (yalnız development) ve tarayıcı testleri (KK-P05-5) bunu çizer.
// Örnek metin içerir: `index.ts` dışa aktarımı ve envanter kapsamı dışındadır; sabit metin taraması
// (hardcoded-text.test) bu dizini bilinçli olarak atlar.
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import {
  CALENDAR_EVENT_TYPES,
  DATA_CLASSES,
  DOCUMENT_STATUSES,
  KUNYE_STATUSES,
} from '@eda/contracts/enums';
import { type ReactNode, useState } from 'react';
import {
  ConversationView,
  Message,
  MessageActions,
  MessageContent,
  ReasoningBlock,
} from '../ai-elements/index.ts';
import {
  Accordion,
  AccordionItem,
  Alert,
  AlertDialog,
  Avatar,
  Badge,
  BrandMark,
  Breadcrumb,
  Button,
  Card,
  CardHeader,
  Checkbox,
  CITATION_VIEW_KEYS,
  CitationStatusBadge,
  Combobox,
  DataClassChip,
  DateField,
  Dialog,
  DocStatusBadge,
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  EmptyState,
  EnvironmentStrip,
  ErrorState,
  EventChip,
  Field,
  FileInput,
  FormErrorSummary,
  Icon,
  IconButton,
  Input,
  Kbd,
  Loader,
  LockedFeatureState,
  NoticeBanner,
  Pagination,
  PasswordInput,
  Popover,
  Progress,
  ProviderBadge,
  RadioCard,
  RadioGroup,
  ScrollArea,
  SectionHeader,
  SegmentedControl,
  Select,
  Sheet,
  Skeleton,
  SourceChip,
  Stepper,
  Switch,
  Table,
  Tabs,
  Td,
  Textarea,
  Th,
  TimeField,
  TONES,
  ToastProvider,
  Tooltip,
  TooltipProvider,
  Tr,
  turkishComboboxFilter,
  useToast,
} from '../index.ts';

const noop = (): void => undefined;

const CITATION_LABELS = {
  pending: 'Doğrulanıyor',
  verified: 'Doğrulandı',
  verified_user_source: 'Eklediğiniz kaynakla doğrulandı',
  out_of_context: 'Bu sohbette getirilmedi',
  out_of_coverage: 'E.D.A. kapsamı dışında',
  source_unavailable: 'Kaynağa şu an ulaşılamıyor',
  not_found: 'Resmî kaynakta bulunamadı',
  attested: 'Avukat beyanı',
  unresolved: 'Kaynak etiketi çözülemedi',
} as const;

const DOC_LABELS = {
  draft: 'Taslak',
  review_pending: 'İncelemede',
  approved: 'Onaylandı',
  exported: 'Dışa aktarıldı',
  filed_declared: 'Dosyalandı (beyan)',
  archived: 'Arşivlendi',
} as const;

const EVENT_LABELS = {
  hearing: 'Duruşma',
  deadline: 'Süre',
  discovery: 'Keşif',
  expert: 'Bilirkişi',
  meeting: 'Görüşme',
  mediation: 'Arabuluculuk',
  task: 'Görev',
} as const;

const DATA_CLASS_LABELS = { public: 'Genel', client: 'Müvekkil', case: 'Dosya' } as const;

const BAROS = [
  { value: 'istanbul', label: 'İstanbul Barosu' },
  { value: 'ankara', label: 'Ankara Barosu' },
  { value: 'izmir', label: 'İzmir Barosu' },
  { value: 'igdir', label: 'Iğdır Barosu' },
];

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-1">
      <h3 className="text-caption font-medium text-fg-subtle">{title}</h3>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

function Showcase({ id }: { id: string }) {
  const [dialog, setDialog] = useState(false);
  const [alert, setAlert] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [baro, setBaro] = useState<string | null>(null);
  const [radio, setRadio] = useState('flash');
  const [tab, setTab] = useState('a');
  const [switchOn, setSwitchOn] = useState(true);
  const toast = useToast();
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Block title="Düğmeler">
        <Row>
          <Button>Birincil</Button>
          <Button variant="secondary">İkincil</Button>
          <Button variant="outline" leadingIcon="action.add">
            Çerçeveli
          </Button>
          <Button variant="ghost">Hayalet</Button>
          <Button variant="danger">Sil</Button>
        </Row>
        <Row>
          <Button size="sm">Küçük</Button>
          <Button size="lg">Büyük</Button>
          <Button disabled>Devre dışı</Button>
          <Button aria-disabled="true" aria-describedby={`${id}-neden`}>
            Gerekçeli
          </Button>
          <Button loading loadingLabel="Kaydediliyor">
            Kaydet
          </Button>
        </Row>
        <p id={`${id}-neden`} className="text-caption text-fg-muted">
          Gerekçe: bu işlem için yönetici rolü gerekir.
        </p>
        <Row>
          <IconButton icon="action.more" label="Diğer seçenekler" />
          <IconButton icon="nav.notifications" label="Bildirimler" variant="outline" indicator />
          <IconButton icon="action.send" label="Gönder" variant="primary" />
          <Tooltip content="Kopyala">
            <IconButton icon="action.copy" label="Kopyala" />
          </Tooltip>
          <Kbd>Ctrl K</Kbd>
        </Row>
      </Block>

      <Block title="Form">
        <Field label="E-posta" description="Giriş için kullanılır.">
          <Input type="email" autoComplete="email" />
        </Field>
        <Field label="Geçersiz alan" error="Geçerli bir e-posta adresi yazın.">
          <Input defaultValue="avukat@" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Salt okunur">
            <Input readOnly defaultValue="2026/1234 E." />
          </Field>
          <Field label="Devre dışı">
            <Input disabled />
          </Field>
          <Field label="Duruşma tarihi">
            <DateField />
          </Field>
          <Field label="Saat">
            <TimeField />
          </Field>
        </div>
        <Field label="Parola">
          <PasswordInput labels={{ show: 'Parolayı göster', hide: 'Parolayı gizle' }} />
        </Field>
        <Field label="Not">
          <Textarea autoGrow maxRows={4} />
        </Field>
        <Field label="Baro">
          <Combobox
            options={BAROS}
            value={baro}
            onValueChange={setBaro}
            filter={turkishComboboxFilter}
            emptyLabel="Sonuç yok"
            labels={{ toggle: 'Seçenekleri göster' }}
            placeholder="Baro arayın"
          />
        </Field>
        <Field label="Mahkeme">
          <Select
            options={[
              { value: 'all', label: 'Tümü' },
              { value: 'yargitay', label: 'Yargıtay' },
            ]}
          />
        </Field>
        <FileInput onFilesSelected={noop} accept=".pdf,.udf,.docx" variant="outline" size="sm">
          Dosya seç
        </FileInput>
        <FormErrorSummary
          title="Formda 2 hata var"
          errors={[
            { fieldId: `${id}-a`, message: 'E-posta gerekli' },
            { fieldId: `${id}-b`, message: 'Baro seçin' },
          ]}
        />
      </Block>

      <Block title="Seçim">
        <Checkbox checked onCheckedChange={noop} label="Bu cihazda oturumu açık tut" />
        <Switch
          checked={switchOn}
          onCheckedChange={setSwitchOn}
          label="Maskeleme"
          description="Kişisel veriler gönderilmeden önce maskelenir."
        />
        <SegmentedControl
          label="Tema"
          value="light"
          onValueChange={noop}
          options={[
            { value: 'light', label: 'Aydınlık', icon: 'theme.light' },
            { value: 'dark', label: 'Karanlık', icon: 'theme.dark' },
            { value: 'system', label: 'Sistem', icon: 'theme.system' },
          ]}
        />
        <RadioGroup
          legend="Yanıt modu"
          value={radio}
          onValueChange={setRadio}
          options={[
            { value: 'flash', label: 'Hızlı', description: 'Günlük sorular' },
            { value: 'pro', label: 'Derin', description: 'Kapsamlı araştırma' },
          ]}
        />
        <RadioGroup legend="Paket" value="team" onValueChange={noop}>
          <RadioCard value="solo" title="Bireysel" description="Tek avukat" />
          <RadioCard value="team" title="Büro" description="En çok 10 kullanıcı" />
        </RadioGroup>
      </Block>

      <Block title="Rozet ve çip">
        <Row>
          {TONES.map((tone) => (
            <Badge key={tone} tone={tone}>
              {tone}
            </Badge>
          ))}
        </Row>
        <Row>
          {DATA_CLASSES.map((c) => (
            <DataClassChip key={c} dataClass={c} label={DATA_CLASS_LABELS[c]} />
          ))}
          <ProviderBadge
            region="TR"
            providerId="deepseek"
            modelLabel="edai-flash"
            labels={{ location: 'İşlem yeri: TR', simulation: 'SİMÜLASYON' }}
          />
          <ProviderBadge
            region="NONE"
            providerId="mock"
            labels={{ location: 'İşlem yeri: yok', simulation: 'SİMÜLASYON' }}
          />
        </Row>
        <Row>
          {DOCUMENT_STATUSES.map((s) => (
            <DocStatusBadge key={s} status={s} labels={DOC_LABELS} />
          ))}
        </Row>
        <Row>
          {CALENDAR_EVENT_TYPES.map((e) => (
            <EventChip
              key={e}
              type={e}
              typeLabel={EVENT_LABELS[e]}
              title="Örnek etkinlik"
              meta="09:30"
              accessibleLabel={`${EVENT_LABELS[e]}, 09:30, örnek etkinlik`}
            />
          ))}
        </Row>
      </Block>

      <Block title="Künye">
        <Row>
          {CITATION_VIEW_KEYS.map((s) => (
            <CitationStatusBadge key={s} status={s} labels={CITATION_LABELS} />
          ))}
        </Row>
        <Row>
          {CITATION_VIEW_KEYS.map((s) => (
            <CitationStatusBadge key={s} status={s} labels={CITATION_LABELS} compact />
          ))}
        </Row>
        <Row>
          <SourceChip shortKunye="Durum bekleniyor" />
          {KUNYE_STATUSES.map((s) => (
            <SourceChip
              key={s}
              status={s}
              shortKunye={CITATION_LABELS[s]}
              label={`Kaynak örneği. Durum: ${CITATION_LABELS[s]}.`}
            />
          ))}
        </Row>
      </Block>

      <Block title="Katmanlar">
        <Row>
          <Button variant="outline" onClick={() => setDialog(true)}>
            Diyalog
          </Button>
          <Button variant="outline" onClick={() => setAlert(true)}>
            Onay diyaloğu
          </Button>
          <Button variant="outline" onClick={() => setSheet(true)}>
            Çekmece
          </Button>
          <Popover
            trigger={<Button variant="outline">Açılır kutu</Button>}
            title="Kaynak kapsamı"
            labels={{ close: 'Kapat' }}
          >
            <p className="text-body-sm text-fg-muted">Yargıtay ve Danıştay kararları.</p>
          </Popover>
          <DropdownMenu trigger={<Button variant="outline">Menü</Button>}>
            <DropdownMenuLabel>Eylemler</DropdownMenuLabel>
            <DropdownMenuItem icon="action.copy" onSelect={noop}>
              Kopyala
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem icon="action.close" tone="danger" onSelect={noop}>
              Sil
            </DropdownMenuItem>
          </DropdownMenu>
          <Button
            variant="outline"
            onClick={() => toast.show({ title: 'Kaydedildi', tone: 'success' })}
          >
            Bildirim
          </Button>
        </Row>
        <Dialog
          open={dialog}
          onOpenChange={setDialog}
          title="Dava klasörü"
          description="Klasör bilgilerini düzenleyin."
          labels={{ close: 'Kapat' }}
          footer={
            <>
              <Button variant="outline" onClick={() => setDialog(false)}>
                Vazgeç
              </Button>
              <Button onClick={() => setDialog(false)}>Kaydet</Button>
            </>
          }
        >
          <Field label="Klasör adı">
            <Input />
          </Field>
        </Dialog>
        <AlertDialog
          open={alert}
          onOpenChange={setAlert}
          title="Belge silinsin mi?"
          impact="Belge ve 3 sürümü kalıcı olarak silinir."
          cancelLabel="Vazgeç"
          destructiveLabel="Sil"
          onConfirm={() => setAlert(false)}
        />
        <Sheet
          open={sheet}
          onOpenChange={setSheet}
          title="Kaynaklar"
          side="right"
          width="panel"
          labels={{ close: 'Kapat' }}
        >
          <p className="text-body-sm text-fg-muted">Kaynak paneli içeriği.</p>
        </Sheet>
      </Block>

      <Block title="Geri bildirim">
        <EnvironmentStrip title="Sentetik ortam">
          Gerçek müvekkil verisi kullanılmaz.
        </EnvironmentStrip>
        <NoticeBanner tone="warning" title="Bakım">
          Bu gece 02.00-03.00 arası kesinti olabilir.
        </NoticeBanner>
        <Alert tone="danger" title="Yükleme başarısız">
          Dosya 50 MB sınırını aşıyor.
        </Alert>
        <Row>
          <Loader label="Doğrulanıyor" />
          <Progress value={64} label="Yükleme" />
        </Row>
        <Skeleton className="h-4 w-2/3" />
        <ErrorState
          as="h3"
          title="Sonuçlar yüklenemedi"
          message="Bağlantı kesildi."
          onRetry={noop}
          requestId="01J0EXAMPLE0000000000000000"
          labels={{
            retry: 'Yeniden dene',
            supportCode: 'Destek kodu',
            copy: 'Kopyala',
            copied: 'Kopyalandı',
          }}
        />
        <EmptyState
          as="h3"
          icon="nav.files"
          title="Henüz dosya yok"
          description="İlk dosyanızı yükleyin."
        />
        <LockedFeatureState
          as="h3"
          title="Hesap doğrulaması bekleniyor"
          description="Baro kaydınız onaylanınca bu özellik açılır."
        />
      </Block>

      <Block title="Gezinme">
        <Breadcrumb
          label="Konum"
          items={[
            // biome-ignore lint/a11y/useAnchorContent: metin Breadcrumb tarafından render öğesine verilir
            { label: 'Dosyalar', render: <a href="#dosyalar" /> },
            // biome-ignore lint/a11y/useAnchorContent: metin Breadcrumb tarafından render öğesine verilir
            { label: 'Kira tahliye', render: <a href="#dava" /> },
            { label: 'Dilekçe' },
          ]}
        />
        <Tabs
          label="Görünüm"
          value={tab}
          onValueChange={setTab}
          items={[
            { value: 'a', label: 'Kararlar', count: 12 },
            { value: 'b', label: 'Mevzuat', count: 4 },
            { value: 'c', label: 'Diğer' },
          ]}
        />
        <Stepper
          label="Adımlar"
          statusLabels={{
            complete: 'Tamamlandı',
            current: 'Etkin',
            pending: 'Bekliyor',
            error: 'Hata',
          }}
          steps={[
            { label: 'Ayıkla', status: 'complete' },
            { label: 'Doğrula', status: 'current' },
            { label: 'Rapor', status: 'pending' },
          ]}
        />
        <Pagination
          hasMore
          onLoadMore={noop}
          labels={{ loadMore: 'Daha fazla göster', loading: 'Yükleniyor' }}
        />
        <Accordion defaultValue={['a']}>
          <AccordionItem value="a" title="Hesap adımları" headingLevel={4}>
            <p className="text-body-sm text-fg-muted">
              Tebliğ tarihi + 2 hafta; tatil günleri atlanır.
            </p>
          </AccordionItem>
          <AccordionItem value="b" title="Dayanak" headingLevel={4}>
            <p className="text-body-sm text-fg-muted">HMK m. 345.</p>
          </AccordionItem>
        </Accordion>
      </Block>

      <Block title="Sohbet (AI Elements)">
        <ConversationView
          label="Örnek sohbet"
          labels={{ scrollToLatest: 'En son yanıta git' }}
          className="h-80 rounded-md border border-border"
        >
          <div className="flex flex-col gap-6 p-4">
            <Message from="user" label="Sizin mesajınız">
              Kira sözleşmesinden sonra alınan tahliye taahhüdü hangi şartlarda geçerlidir?
            </Message>
            <Message
              from="assistant"
              label="E.D.A. yanıtı"
              header={
                <>
                  <span className="font-medium text-fg">E.D.A. Hukuk</span>
                  <span>14.32</span>
                  <ProviderBadge
                    region="TR"
                    providerId="deepseek"
                    modelLabel="edai-flash"
                    labels={{ location: 'İşlem yeri: TR', simulation: 'SİMÜLASYON' }}
                  />
                </>
              }
              footer={
                <MessageActions
                  labels={{
                    group: 'Yanıt eylemleri',
                    copy: 'Kopyala',
                    regenerate: 'Yeniden üret',
                    like: 'Beğen',
                    dislike: 'Beğenme',
                    export: 'Dışa aktar',
                  }}
                  onCopy={noop}
                  onRegenerate={noop}
                  onFeedback={noop}
                  onExport={noop}
                  feedback="up"
                />
              }
            >
              <ReasoningBlock summary="Akıl yürütme">
                Soru kira hukukuna ilişkin; taahhüdün düzenlenme zamanı belirleyicidir.
              </ReasoningBlock>
              <MessageContent>
                <p>
                  Örnek yanıt metni; atıflar kayıttan gelen künye çipiyle gösterilir{' '}
                  <SourceChip status="verified" shortKunye="Örnek künye" />.
                </p>
              </MessageContent>
            </Message>
          </div>
        </ConversationView>
      </Block>

      <Block title="Gösterim">
        <Row>
          <BrandMark />
          <Avatar initials="AY" label="Av. Ayşe Yılmaz" />
          <Icon icon="status.verified" label="Doğrulandı" />
        </Row>
        <Card className="p-4">
          <CardHeader title="Kart başlığı" description="Kart açıklaması" />
        </Card>
        <ScrollArea label="Kaydırılabilir liste" className="h-24 rounded-md border border-border">
          <ul className="flex flex-col gap-1 p-2 text-body-sm">
            {Array.from({ length: 8 }, (_, i) => (
              <li key={i}>Satır {i + 1}</li>
            ))}
          </ul>
        </ScrollArea>
        <Table caption="Örnek tablo">
          <thead>
            <tr>
              <Th>Belge</Th>
              <Th>Durum</Th>
            </tr>
          </thead>
          <tbody>
            <Tr>
              <Td>Cevap dilekçesi</Td>
              <Td>
                <DocStatusBadge status="draft" labels={DOC_LABELS} />
              </Td>
            </Tr>
            <Tr>
              <Td>İhtarname</Td>
              <Td>
                <DocStatusBadge status="approved" labels={DOC_LABELS} />
              </Td>
            </Tr>
          </tbody>
        </Table>
      </Block>
    </div>
  );
}

export function ComponentShowcase() {
  return (
    <TooltipProvider>
      <ToastProvider
        durationMs={CONFIG_DEFAULTS['ui.toastDurationMs']}
        labels={{ region: 'Bildirimler', close: 'Kapat' }}
      >
        <KitchenSinkBody />
      </ToastProvider>
    </TooltipProvider>
  );
}

function KitchenSinkBody() {
  return (
    <main id="icerik" className="flex flex-col">
      <header className="flex items-center gap-2.5 border-b border-border bg-surface px-6 py-4">
        <BrandMark />
        <h1 className="font-display text-heading-md text-fg">Bileşen vitrini</h1>
      </header>
      {(
        [
          ['light', 'comfortable', 'Açık tema, rahat yoğunluk'],
          ['dark', 'compact', 'Koyu tema, sıkı yoğunluk'],
        ] as const
      ).map(([theme, density, title]) => (
        <section
          key={theme}
          data-theme={theme}
          data-density={density}
          aria-labelledby={`vitrin-${theme}`}
          className="flex flex-col gap-4 bg-bg px-6 py-8 text-fg"
        >
          <SectionHeader id={`vitrin-${theme}`} title={title} />
          <Showcase id={theme} />
        </section>
      ))}
    </main>
  );
}
