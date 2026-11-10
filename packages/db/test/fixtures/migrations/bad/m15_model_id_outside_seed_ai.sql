-- lint-as: 0015_seed_providers.sql
-- lint-expect: M-15
-- Model kimliği test sırasında {{MODEL_ID}} yerine yazılır (Y-96: fixture dosyasında kimlik tutulmaz).
-- eda:kind seed
INSERT INTO app.ai_models (provider_model_id) VALUES ('{{MODEL_ID}}');
