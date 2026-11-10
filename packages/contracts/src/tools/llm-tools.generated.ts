// ÜRETİLMİŞ DOSYA (gen-tools, 021 §4.15): elle düzenleme. Kilit: tools.lock.json.
export const LLM_TOOL_DEFS = [
  {
    "name": "search_decisions",
    "description": "Yargı kararlarında arama: önce yerel korpus, gerekirse resmî kaynak. Her sonuç [K3] gibi etiket taşır; içtihada yalnız bu etiketle atıf yap, künye yazma. Kısa hukuki ifade kullan; tam ifade için çift tırnak. Kişisel veri (ad, T.C. no, dosya no) yazma. Metin için get_decision.",
    "parameters": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description": "Kısa hukuki arama ifadesi; tam ifade için çift tırnak."
        },
        "court_types": {
          "description": "Mahkeme türleri; null: kapsamdaki tümü.",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "string",
                "enum": [
                  "yargitay",
                  "danistay",
                  "istinaf_hukuk",
                  "ilk_derece_hukuk",
                  "kyb",
                  "aym_norm",
                  "aym_bireysel",
                  "uyusmazlik"
                ]
              }
            },
            {
              "type": "null"
            }
          ]
        },
        "chamber": {
          "description": "Daire kodu: H9, C4, D10, HGK, CGK, IDDK, VDDK; null: tümü.",
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "date_from": {
          "description": "Karar tarihi alt sınırı (GG.AA.YYYY) veya null.",
          "anyOf": [
            {
              "type": "string",
              "pattern": "^\\d{2}\\.\\d{2}\\.\\d{4}$"
            },
            {
              "type": "null"
            }
          ]
        },
        "date_to": {
          "description": "Karar tarihi üst sınırı (GG.AA.YYYY) veya null.",
          "anyOf": [
            {
              "type": "string",
              "pattern": "^\\d{2}\\.\\d{2}\\.\\d{4}$"
            },
            {
              "type": "null"
            }
          ]
        },
        "esas_no": {
          "description": "Belirli kararın esas no'su (YYYY/N) veya null.",
          "anyOf": [
            {
              "type": "string",
              "pattern": "^\\d{4}\\/\\d{1,7}$"
            },
            {
              "type": "null"
            }
          ]
        },
        "karar_no": {
          "description": "Belirli kararın karar no'su (YYYY/N) veya null.",
          "anyOf": [
            {
              "type": "string",
              "pattern": "^\\d{4}\\/\\d{1,7}$"
            },
            {
              "type": "null"
            }
          ]
        },
        "live": {
          "type": "boolean",
          "description": "Yalnız kullanıcı resmî kaynakta aramayı istediyse true."
        },
        "page": {
          "description": "Sayfa (1'den başlar) veya null.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": 1,
              "maximum": 9007199254740991
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "required": [
        "query",
        "court_types",
        "chamber",
        "date_from",
        "date_to",
        "esas_no",
        "karar_no",
        "live",
        "page"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "get_decision",
    "description": "Arama sonucundaki kararın metnini rol etiketli bölümler hâlinde getirir (bölüm ≤ 6.000 karakter). section ve role null ise bölüm listesi ve ilk bölüm döner; gerekçe/hüküm için role ver.",
    "parameters": {
      "type": "object",
      "properties": {
        "ref": {
          "type": "string",
          "description": "Kaynak etiketi, ör. K3.",
          "pattern": "^K\\d{1,4}$"
        },
        "section": {
          "description": "Bölüm no veya null.",
          "anyOf": [
            {
              "type": "integer",
              "minimum": 1,
              "maximum": 9007199254740991
            },
            {
              "type": "null"
            }
          ]
        },
        "role": {
          "description": "İstenen bölüm rolü (gerekce, hukum…) veya null.",
          "anyOf": [
            {
              "type": "string",
              "enum": [
                "kunye",
                "istem",
                "taraf_iddiasi",
                "gerekce",
                "hukum",
                "karsi_oy",
                "tetkik_hakimi",
                "diger"
              ]
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "required": [
        "ref",
        "section",
        "role"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "search_legislation",
    "description": "Yürürlükteki mevzuat maddelerinde arama (güncel metin). Sonuçlar [K#] etiketi taşır; madde atfını 'TBK m. 49' biçiminde yazabilirsin. Kanun numarası biliniyorsa law_no ver.",
    "parameters": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description": "Arama ifadesi, ör. 'kira bedelinin tespiti'."
        },
        "law_no": {
          "description": "Kanun numarası (ör. 6098) veya null.",
          "anyOf": [
            {
              "type": "string",
              "pattern": "^\\d{1,5}$"
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "required": [
        "query",
        "law_no"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "get_legislation_article",
    "description": "Kanun maddesinin metnini getirir: ref ya da law_no + article_no. Aralık için '344-346' (en çok 5 madde). as_of verilirse o tarihteki metin; geçmiş sürüm yoksa güncel metin ve uyarı döner.",
    "parameters": {
      "type": "object",
      "properties": {
        "ref": {
          "description": "Kaynak etiketi (ör. K5) veya null.",
          "anyOf": [
            {
              "type": "string",
              "pattern": "^K\\d{1,4}$"
            },
            {
              "type": "null"
            }
          ]
        },
        "law_no": {
          "description": "Kanun numarası (ör. 6098) veya null.",
          "anyOf": [
            {
              "type": "string",
              "pattern": "^\\d{1,5}$"
            },
            {
              "type": "null"
            }
          ]
        },
        "article_no": {
          "description": "Madde: '49', '344/A', 'Geçici 1' ya da '344-346'; veya null.",
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "as_of": {
          "description": "Yürürlük tarihi (GG.AA.YYYY) veya null: güncel.",
          "anyOf": [
            {
              "type": "string",
              "pattern": "^\\d{2}\\.\\d{2}\\.\\d{4}$"
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "required": [
        "ref",
        "law_no",
        "article_no",
        "as_of"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "search_case_files",
    "description": "Sohbete bağlı dava dosyasının evrakında ve sohbet eklerinde arar; ilgili pasajları [K#] etiketiyle döndürür. Evrak içeriğine dair sorularda önce bunu kullan. Bağlı dosya veya ek yoksa hata döner.",
    "parameters": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description": "Evrakta aranacak ifade."
        },
        "doc_types": {
          "description": "Evrak türleri veya null: tümü.",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "string",
                "enum": [
                  "petition",
                  "decision",
                  "interim_decision",
                  "service_notice",
                  "expert_report",
                  "minutes",
                  "indictment",
                  "contract",
                  "power_of_attorney",
                  "evidence",
                  "other"
                ]
              }
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "required": [
        "query",
        "doc_types"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "calculate_deadline",
    "description": "Usul süresini süre motoruyla hesaplar (resmî ve adli tatil dahil). Süreyi kendin hesaplama; yanıtta yalnız bu sonucu kullan. Sonuç kullanıcıya 'Takvime ekle' önerisi olarak gösterilir, takvime yazılmaz.",
    "parameters": {
      "type": "object",
      "properties": {
        "branch": {
          "type": "string",
          "description": "Yargı kolu.",
          "enum": [
            "hmk",
            "cmk",
            "iyuk",
            "iik",
            "mediation"
          ]
        },
        "action": {
          "type": "string",
          "description": "Süre konusu işlem, ör. 'istinaf', 'cevap dilekçesi'."
        },
        "start_event": {
          "type": "string",
          "description": "service=tebliğ, pronouncement=tefhim, learning=öğrenme.",
          "enum": [
            "service",
            "pronouncement",
            "learning"
          ]
        },
        "start_date": {
          "type": "string",
          "description": "Olay tarihi (GG.AA.YYYY).",
          "pattern": "^\\d{2}\\.\\d{2}\\.\\d{4}$"
        },
        "service_method": {
          "description": "Tebliğ yolu: postal veya e_tebligat; null: bilinmiyor.",
          "anyOf": [
            {
              "type": "string",
              "enum": [
                "postal",
                "e_tebligat"
              ]
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "required": [
        "branch",
        "action",
        "start_event",
        "start_date",
        "service_method"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "create_document",
    "description": "Yeni belge taslağı başlatır (dilekçe, ihtarname, mütalaa, serbest). Önce düzenlenebilir plan kullanıcıya sunulur; metin onaydan sonra yazılır. Kullanıcı açıkça belge istemediyse önce sor.",
    "parameters": {
      "type": "object",
      "properties": {
        "kind": {
          "type": "string",
          "description": "petition=dilekçe, notice=ihtarname, memo=mütalaa, free=serbest.",
          "enum": [
            "petition",
            "notice",
            "memo",
            "free"
          ]
        },
        "subtype": {
          "description": "Alt tür, ör. 'istinaf dilekçesi', veya null.",
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "instructions": {
          "type": "string",
          "description": "Talebin ve önemli olguların kısa özeti."
        },
        "source_refs": {
          "description": "Kullanılacak kaynak etiketleri veya null.",
          "anyOf": [
            {
              "type": "array",
              "items": {
                "type": "string",
                "pattern": "^K\\d{1,4}$"
              }
            },
            {
              "type": "null"
            }
          ]
        },
        "responds_to_ref": {
          "description": "Cevap verilecek evrakın etiketi veya null.",
          "anyOf": [
            {
              "type": "string",
              "pattern": "^K\\d{1,4}$"
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "required": [
        "kind",
        "subtype",
        "instructions",
        "source_refs",
        "responds_to_ref"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "edit_document",
    "description": "Açık belgede blok bazlı düzenleme önerileri üretir; avukat kabul veya reddeder. block_id değerlerini belge bağlamından al; her işleme kısa gerekçe yaz. İçtihat atfı yalnız [K#] ile.",
    "parameters": {
      "type": "object",
      "properties": {
        "ops": {
          "type": "array",
          "description": "Düzenleme işlemleri (sırayla uygulanır).",
          "items": {
            "type": "object",
            "properties": {
              "type": {
                "type": "string",
                "description": "replace_block, insert_after, delete_block, replace_text.",
                "enum": [
                  "replace_block",
                  "insert_after",
                  "delete_block",
                  "replace_text"
                ]
              },
              "block_id": {
                "type": "string",
                "description": "Hedef blok kimliği."
              },
              "role": {
                "description": "Yalnız insert_after: yeni bölümün rolü; diğerlerinde null.",
                "anyOf": [
                  {
                    "type": "string",
                    "enum": [
                      "courtHeader",
                      "partiesGrid",
                      "subjectLine",
                      "numberedExplanations",
                      "legalGrounds",
                      "evidenceList",
                      "resultAndRequest",
                      "attorneySignature",
                      "generic",
                      "freeSection"
                    ]
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "content": {
                "description": "Yeni metin (replace_block, insert_after) veya null.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "find": {
                "description": "replace_text: aranan ifade; diğerlerinde null.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "replace": {
                "description": "replace_text: yeni ifade; diğerlerinde null.",
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "occurrence": {
                "description": "replace_text: kaçıncı geçiş (1'den) veya null.",
                "anyOf": [
                  {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 9007199254740991
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "reason": {
                "type": "string",
                "description": "Kısa gerekçe."
              },
              "source_refs": {
                "description": "Dayanak kaynak etiketleri veya null.",
                "anyOf": [
                  {
                    "type": "array",
                    "items": {
                      "type": "string",
                      "pattern": "^K\\d{1,4}$"
                    }
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            },
            "required": [
              "type",
              "block_id",
              "role",
              "content",
              "find",
              "replace",
              "occurrence",
              "reason",
              "source_refs"
            ],
            "additionalProperties": false
          }
        }
      },
      "required": [
        "ops"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "submit_outline",
    "description": "Dilekçe modunun ilk adımı: belge planını gönder. Plan kullanıcıya düzenlenebilir gösterilir. partiesGrid ve attorneySignature bölümlerinin metnini yazma, yalnız listele. Eksik bilgileri questions ile sor.",
    "parameters": {
      "type": "object",
      "properties": {
        "kind": {
          "type": "string",
          "description": "petition=dilekçe, notice=ihtarname, memo=mütalaa, free=serbest.",
          "enum": [
            "petition",
            "notice",
            "memo",
            "free"
          ]
        },
        "subtype": {
          "description": "Alt tür, ör. 'cevap dilekçesi', veya null.",
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "court": {
          "description": "Mahkeme/merci adı veya null.",
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "subject": {
          "type": "string",
          "description": "Belgenin konusu (tek cümle)."
        },
        "sections": {
          "type": "array",
          "description": "Bölüm planı (sırayla).",
          "items": {
            "type": "object",
            "properties": {
              "role": {
                "type": "string",
                "enum": [
                  "courtHeader",
                  "partiesGrid",
                  "subjectLine",
                  "numberedExplanations",
                  "legalGrounds",
                  "evidenceList",
                  "resultAndRequest",
                  "attorneySignature",
                  "generic",
                  "freeSection"
                ]
              },
              "heading": {
                "type": "string",
                "description": "Bölüm başlığı."
              },
              "intent": {
                "type": "string",
                "description": "Bu bölümde ne yazılacağı (1-2 cümle)."
              },
              "source_refs": {
                "description": "Dayanak kaynak etiketleri veya null.",
                "anyOf": [
                  {
                    "type": "array",
                    "items": {
                      "type": "string",
                      "pattern": "^K\\d{1,4}$"
                    }
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            },
            "required": [
              "role",
              "heading",
              "intent",
              "source_refs"
            ],
            "additionalProperties": false
          }
        },
        "questions": {
          "type": "array",
          "description": "Kullanıcıya sorulacak eksik bilgiler (yoksa boş dizi).",
          "items": {
            "type": "string"
          }
        }
      },
      "required": [
        "kind",
        "subtype",
        "court",
        "subject",
        "sections",
        "questions"
      ],
      "additionalProperties": false
    }
  }
] as const;
