// Türkçe verilen adlar (026 §6.4 gazetteer). Hukuk onayı bekliyor.
// Kaynak: ortak dil bilgisinden ELLE derlenmiş ilk liste (alıntı liste yok; lisansı belirsiz kaynak
// kullanılmadı). Hedef >= 1.500 ad; Wikidata (CC0) aktarımı proje sahibinin vereceği dosyayla sonraya
// bırakıldı (P08 E4). Yalnız verilen adlardır; soyadı listesi yoktur. Eşleşme foldChars ile.

const RAW = `
Abbas Abdi Abdullah Abdulkadir Abdurrahman Abdülhamit Abdülkadir Abdülkerim Abdüllatif Abdülsamet
Abidin Abide Adalet Adem Adil Adile Adnan Afet Afife Afitap Ağah Ahmet Ahmetcan Ahsen Ahu Akasya Akgül
Akif Akın Aksel Aksu Ala Alaattin Alara Alev Ali Alican Alihan Alim Alize Alkan Alp Alparslan Alpaslan
Alper Alperen Alptekin Altan Altay Altın Altınay Alya Amine Anıl Arda Ardahan Arif Arife Arın Arman
Armağan Arslan Arya Arzu Asaf Asel Asena Asım Asiye Aslan Aslı Aslıhan Asuman Asya Aşkın Ata Atahan
Atakan Atalay Ataman Atıf Atila Atilla Avni Ayaz Aybala Aybars Ayben Aybeniz Aybike Aybüke Ayca Ayça
Aydan Aydeniz Aydın Ayfer Aygen Aygül Aygün Ayhan Aykut Ayla Aylin Aynur Ayperi Aysel Aysima Aysu Aysun
Ayşe Ayşegül Ayşen Aytaç Aytekin Ayten Aytuğ Aytül Ayvaz Azat Azime Aziz Azize Azra
Bahadır Bahar Bahattin Bahri Bahriye Baki Balkan Banu Baran Barbaros Barış Barlas Batu Batuhan Bayram
Bedia Bedirhan Bedrettin Bedri Begüm Behçet Behice Behiye Behzat Bekir Belgin Belkıs Belma Benan Bengi
Bengisu Bengü Berat Berfin Berivan Berk Berkan Berkay Berke Berna Berra Berrak Bertan Besim Beste Beşir
Betül Beyhan Beyza Beyzanur Bihter Bilal Bilge Bilgehan Bilgen Bilgin Billur Binnur Bircan Birgül Birkan
Birol Birsen Birtan Bora Boran Buket Bulut Burak Burcu Burçak Burçin Burhan Burhanettin Burkay Buse Bülent
Bünyamin Büşra
Cafer Cahide Cahit Can Canan Canberk Candan Caner Cansel Cansın Cansu Cavidan Cavit Cebrail Celal
Celalettin Celil Cem Cemal Cemalettin Cemil Cemile Cemre Cengiz Cenk Cennet Ceren Cevat Cevdet Cevher
Cevriye Ceyda Ceyhun Ceylan Ceylin Cezmi Cihan Cihangir Cihat Civan Coşkun Cuma Cumali Cüneyt
Çağan Çağatay Çağdaş Çağıl Çağla Çağlar Çağlayan Çağrı Çelen Çetin Çiğdem Çiler Çilem Çınar Çisem
Dağhan Damla Davut Defne Demet Demirhan Demircan Deniz Derin Derman Derviş Derya Devran Devrim Dicle
Didem Dilan Dilara Dilay Dilber Dilek Dilhan Dilruba Dilşad Dilşah Dinçer Doğa Doğan Doğukan Doğuş Dora
Doruk Döndü Dönüş Dudu Duran Durdu Durmuş Dursun Duru Duygu Dündar Dürdane
Ebru Ecem Ece Ecrin Eda Edip Efe Efecan Efsun Ekin Ekrem Ela Elanur Elçin Elif Elifnur Elisa Elmas Elvan
Elvin Emel Emin Emine Emir Emircan Emirhan Emrah Emre Emrullah Ender Enes Engin Enis Ensar Enver Ercan
Ercüment Erdal Erdem Erdi Erdinç Erdoğan Eren Erencan Ergin Ergül Ergün Erhan Erkan Erkin Erman Erol Ersin
Ersoy Erşan Ertan Ertekin Ertuğrul Ertürk Esat Esen Esengül Esin Eslem Esma Esmeray Esra Eşref Ethem
Evin Evren Eylül Eymen Eyşan Eyüp Ezel Ezgi Ezgin
Fadıl Fadime Fahrettin Fahri Fahriye Faik Faruk Fatih Fatma Fatmagül Fatoş Fazıl Fazilet Fehime Fehmi
Feray Ferda Ferdi Ferhan Ferhat Feride Feridun Feriha Ferit Ferzan Fevzi Feyyaz Feyza Feyzullah Fidan
Figen Fikret Fikri Fikriye Filiz Firuze Fırat Fuat Fulya Funda Furkan Fuzuli Fügen Füsun
Gaffar Galip Gamze Gani Gaye Gazi Gizem Gökay Gökben Gökçe Gökçen Gökhan Gökmen Göksel Göksu Göktuğ
Gönül Gözde Gül Gülay Gülbahar Gülben Gülbin Gülcan Gülçin Güldane Gülden Gülderen Güler Gülfem Gülhan
Gülistan Gülizar Güllü Gülnur Gülsen Gülseren Gülsüm Gülsün Gülşah Gülşen Gülten Gültekin Gülümser
Gümüş Günal Günay Gündüz Güner Güneş Güney Güngör Gürbüz Gürkan Gürol Gürsel Güven Güzide Güzin
Habib Hacer Hacı Hadi Hafize Hakan Hakime Hakkı Halil Halide Halime Halis Halit Haluk Hamdi Hamide
Hamit Hamza Handan Hande Hanife Hanım Hanzade Harika Harun Hasan Hasibe Hasret Hatem Hatice Hatun Havva
Hayal Hayati Haydar Hayrettin Hayri Hayriye Hayrullah Hazal Hazan Hazar Hediye Helin Hicran Hidayet
Hikmet Hilal Hilmi Hilmiye Hira Hiranur Hızır Hulusi Hurşit Hüda Hülya Hüma Hümeyra Hürriyet
Hüsamettin Hüseyin Hüsnü Hüsniye
Ilgaz Ilgın Irmak Işıl Işılay Işın Işık
İbrahim İclal İdil İdris İhsan İkbal İlay İlayda İlhami İlhan İlkay İlke İlker İlkim İlkin İlknur
İlyas İmren İnan İnci İpek İrem İsa İshak İsmail İsmet İsmihan İsrafil İzel İzzet İzzettin
Jale Jülide
Kaan Kader Kadir Kadriye Kağan Kamil Kamile Kamuran Kandemir Kani Kardelen Kartal Kayahan Kayhan Kayra
Kazım Kemal Kemalettin Kenan Kerem Keriman Kerim Kerime Kevser Kezban Kıvanç Kıvılcım Kıymet Koray
Kubilay Kudret Kumru Kumsal Kurtuluş Kutay Kutlay Kutlu Kuzey Kübra Kürşat
Lal Lale Lalezar Lamia Latif Latife Leman Lerzan Levent Leyla Lina Lokman Lütfi Lütfiye
Macide Mahir Mahmure Mahmut Makbule Malik Mansur Masal Mazhar Medine Mediha Mefküre Mehlika Mehmet
Mehmetcan Mehtap Mehveş Melahat Melda Melek Meliha Melih Melike Melis Melisa Meltem Memduh Menderes
Menekşe Mennan Meral Merdan Merih Mert Mertcan Merve Meryem Meserret Mesude Mesut Mete Metehan Metin
Meva Mevlüt Mihri Mihriban Mihrimah Mine Mira Miraç Miray Mirza Mithat Mualla Muammer Muazzez Muhammed
Muhammet Muharrem Muhittin Muhsin Mukadder Mukaddes Murat Musa Mustafa Muzaffer Müberra Mücahit Müge
Müjde Mükerrem Mümin Mümtaz Münevver Münir Mürüvvet Müslüm Müzeyyen
Naciye Naci Nadide Nadir Nadire Nafiz Nail Naim Nalan Namık Nazan Nazife Nazım Nazlı Nazmiye Nebahat
Nebi Necati Necdet Necibe Necip Necla Necmettin Necmi Necmiye Nedim Nedret Nefise Nehir Nejat Nergis
Neriman Nermin Nesibe Nesime Neslihan Nesrin Neşe Neval Nevin Nevzat Nezahat Nezaket Nezih Nezihe Nida
Nihal Nihan Nihat Nil Nilay Nilgün Nilsu Nilüfer Nimet Nisa Nisanur Nizam Nuh Numan Nur Nuran Nuray
Nurcan Nurdan Nurettin Nurgül Nurhan Nurhayat Nuri Nuriye Nursel Nursu Nurşen Nurten Nusret Nüket Nükhet
Oğulcan Oğuz Oğuzhan Okan Okay Oktay Olcay Olgun Onat Onur Onuralp Orçun Orhan Orkun Osman Oya Oylum
Oytun Ozan
Öcal Ömer Ömür Önder Öykü Özay Özcan Özden Özen Özer Özge Özgen Özgül Özgür Özhan Özkan Özlem Özlen Öznur
Pakize Pamir Pelin Pelinsu Pembe Peri Perihan Perran Pervin Petek Peyami Pınar Polat Poyraz
Rabia Rafet Rafi Ragıp Rahime Rahmi Rahşan Raife Rana Rasim Rasime Raşit Rauf Recep Refik Reha Remzi
Remziye Rengin Reşat Reşit Reyhan Rezan Rıdvan Rıfat Rıza Rifat Ruhi Ruken Rukiye Rümeysa Rüstem Rüştü
Rüya Rüzgar
Saadet Saba Sabahattin Sabiha Sabire Sabri Sacit Sadettin Sadi Sadık Sadiye Sadullah Safa Saffet Safiye
Sahra Saim Sakine Salih Saliha Salim Samet Sami Samiye Sanem Saniye Sare Sarp Savaş Seçil Seda Sedat
Sefa Sefer Seher Selahattin Selami Selcan Selçuk Selda Selen Selim Selime Selin Selma Selvi Sema Semahat
Semih Semiha Semra Sencer Senem Seniha Sennur Serap Serdar Seren Serhan Serhat Serkan Sermin Serpil Serra
Sertaç Sertan Servet Sevan Seval Sevda Sevde Sevgi Sevgül Sevil Sevilay Sevim Sevinç Sevtap Seyfi
Seyhan Seyit Seyithan Sezai Sezen Sezer Sezgin Sezin Sıla Sırrı Sibel Simge Sinan Sinem Soner Songül
Sonay Suat Sude Sudenur Sultan Suna Suphi Suzan Süheyla Sühendan Süleyman Sümeyye Süreyya
Şaban Şadan Şahap Şahane Şahika Şahin Şakir Şamil Şaziye Şebnem Şefik Şehmus Şehnaz Şehriban Şemsettin
Şemsi Şenay Şenel Şener Şengül Şenol Şerafettin Şeref Şerif Şerife Şermin Şevket Şevval Şeyda Şeyma
Şeymanur Şirin Şükran Şükriye Şükrü Şule
Taha Tahir Tahire Tahsin Talat Talha Talip Talya Tamer Taner Tanju Tansel Tansu Tarık Tayfun Tayfur
Tayyar Tekin Temel Teoman Tevfik Tezcan Timur Tolga Toygar Tuba Tufan Tuğba Tuğberk Tuğçe Tuğrul Tuna
Tunahan Tunç Tuncay Tuncer Turan Turgay Turgut Turhan Tutku Tülay Tülin Tülün Tümay Türkan Türker
Ufuk Uğur Ulaş Ulus Ulvi Ulviye Umay Umur Umut Umutcan Ural Uras Utkan Utku Uygar
Ülfet Ülker Ülkü Ümit Ümmü Ümmühan Ümran Ünal Ünsal Ünzile Üzeyir
Vahap Vahdet Vahide Vahit Vasfiye Vecdi Vecihe Vedat Vefa Vehbi Veli Vesile Veysel Vicdan Vildan
Volkan Vural Vuslat
Yade Yağız Yağmur Yahya Yakup Yalçın Yalın Yaprak Yaren Yasemin Yasin Yasir Yaşar Yavuz Yekta Yelda
Yeliz Yener Yeşim Yeter Yıldıray Yıldırım Yıldız Yiğit Yiğitcan Yonca Yunus Yurdakul Yusuf Yücel
Yüksel Yüsra
Zafer Zahide Zahit Zakir Zarife Zehra Zekai Zekeriya Zeki Zekiye Zeliha Zerda Zeren Zerrin Zeycan
Zeynep Zinnur Ziya Zuhal Zübeyde Zübeyir Zühal Zülfikar Zülfü Zülküf Zümra Zümrüt
Abdulbaki Abdulhakim Abdulkerim Abdullatif Abdulvahap Abuzer Ahmetali Akile Akman Alanur Alpay Alpcan
Altuğ Anıla Arafat Aral Aras Arca Arcan Ardıç Asılhan Aslınur Ataberk Ataç Ateş Atiye Atiyye Aybüge
Aycan Aydemir Aygün   Aykan Aynil Aysan Ayşin Aytan Aytunç Azade Azem Azer
Bade Bahtiyar Banuçiçek Barışcan Battal Baykal Baykan Behram Belde Benay Benlifer Bensu Berhan Berkcan
Berker Berkin Besra Beyazıt Bilgecan Biray Birce Birnur Birsu Bozkurt Burcin Buğra Burakcan Burçe
Büşranur Bünyamin
Canay Canbek Candemir Canel Canfeza Canset Cavide Cemali Cemilcan Cemşit Cenan Ceyla   Cihannur
Cindi Coşku Cumhur Cüneyd
Çağın Çağdan Çağrıhan Çelikay Çiçek Çidem Çimen
Dağıstan Delal Demirkan Denizhan Deren Derinsu   Destan Dila Dilge Dilşen Dinç Doğancan Doğanay
Doğuhan Dolunay Dönay   Dündar Dürrin Dürüye
Ebrar Ecemnur Edanur Efnan Ekber Eftal Ekincan Elfida Eliz Elvida Emek Emirali Emrecan Enver Erçin
Erdener   Erim Erinç Erkal Erkut Ersan Ertunç Esenay Esila Eslemnur Esmanur Etka Evrim Eyşe
Fahrünnisa Feyzanur   Fulden Fuzule Ferdane Fersan Feyhan Fatmanur Fethi Fethiye Fethullah
Fikriye Firdevs
Garip Gökalp Gökberk Gökdeniz Gökhun Gökşin Gülay Gülbeyaz Gülbike Gülce Güldehan Gülece Gülfidan
Gülnaz Gülnihal Gülperi Gülruh Gülsevin Gülsima   Gülşahin Gültaç Gülüzar Günce Gündoğdu
Güngörmüş Günseli Gürcan Gürhan Güvenç
Habibe Hacere Hakikat Halef Halil İbrahim Halise Hamiyet Hanefi Hasancan Hasbiye Hatip Haticenur Hayrünnisa
Hazel   Hilalnur Hikmetullah Hilmican Hiranur Hulki Hümay Hüsna Hüsnüye
Ilgar Irazca Işıkhan Işınsu
İlbey İlgi İlgin İlkan İlkutay İlteriş İmge İnayet İpekçe İsmigül İsmihan İzzet
Kadem Kadife Kalender Kamer Kamran Karahan Kayacan Kazımcan Kemalcan Kerimcan   Kıvılay Kibar
Kurtcan Kutalmış Kübranur
Lalehan Lebibe Lemi Lemis Levend Lütfullah
Mahinur Mahmure Mahperi Maide Makbul   Mehdi Mehmetali Mehpare Melikşah Melisanur Memet Mercan
Merdiye Merve Mesrure Mestan Metincan Mihran Mirac Mısra Mükremin Mürşit Müşerref Müşfik Müzehher
Nagehan Naz Nazende Nazenin Nazlıcan Necmeddin Nedime Nefes Nesil Nevra Nevruz Nevzad Neyyire Nihan
Nimetullah Nur Ayşe Nurseli Nursima Nurşah Nurşin Nurtaç Nüvit
  Oğuzcan Okşan   Onurcan Orhun Orkide Ortaç Ozanalp
Ögetay Öktem Ömercan Ömrüm Önay Örsan Özalp Özbey   Özge Özgenur Özgün Özlenen  
Pakizer Parla Pekcan Pembegül Perim Peyman Pınarnur
Rabiya Rafiye Rahiye Ramadan Raziye Recai Refika Rezzan Rukiyenur Rümeyza
Sabire Sadberk Sadık Saffiye Sahure Samime Saniye Satı Satılmış Seçkin Sedanur Sedef Sehernur Selahat
Selimcan Semanur Sena Senanur Serdal Serenay Sevcan Sevginur Sevgican Sevinçnur Seyhun Sezgül Sılanur
Sima Sinemis Sirin Solmaz Sumru Sunay Süheyl Sümer Sümeyra Süreyyanur
Şafak Şahnur Şahsenem Şanser Şaziment Şefika Şehri Şehzat Şenalp Şennur Şeyhmus Şimal Şirvan Şölen
Tahsincan Taliha Tamay Tanay Tanel Tangül   Tanyeli Tarkan Taylan Teslime Tilbe Toprak Tuana
Tuçe Tuğcan Tülinay Tülüce Tülüş Turna
Ufukcan Uğurcan Ulaşcan Umutay Uraz Uzay
Ülgen Ümitcan Ümmügülsüm Ünalcan Ünzüle Üstün
Vahdettin Vasıf Veda Vedia Vehbiye Velican Verda Veysi Visal
Yadigar Yağmurcan   Yaşarcan Yavuzhan Yekbun Yelin   Yiğithan Yüce   Yurdanur
Zekiye Zelal Zelihan Zemzem Zenan Zeyno Zinet Zişan Ziynet Züleyha Zülal Zülfiye
`;

function words(raw: string): string[] {
  return raw.split(/\s{1,8}/u).filter((w) => w.length > 0);
}

/** Tekil, sıralı ad listesi (özgün yazım). */
export const GIVEN_NAMES: readonly string[] = [...new Set(words(RAW))].sort();
