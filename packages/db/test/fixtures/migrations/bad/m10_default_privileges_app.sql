-- lint-as: 0010_rls_default_privileges.sql
-- lint-expect: M-10
-- eda:kind rls
ALTER DEFAULT PRIVILEGES FOR ROLE eda_owner IN SCHEMA app GRANT SELECT ON TABLES TO eda_app;
