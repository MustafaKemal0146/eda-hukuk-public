// Hata `actions` sözlüğü (044 §5.3 ve "Yeni tanımlanan adlar"). İstemci bilmediği eylemi yok sayar.

export const ERROR_ACTIONS = [
  'login',
  'step_up',
  'enroll_totp',
  'enroll_passkey',
  'select_org',
  'reload',
  'open_kunye_check',
  'contact_support',
  'stop_and_send',
  'new_public_conversation',
  'remove_personal_data',
  'notify_org_admin',
  'accept_ai_policy',
  'attest',
  'add_source',
  'reverify',
  'remove_citation',
  'wait',
  'open_portal',
  'offboard_member',
  'manage_seats',
  'upgrade_plan',
  'buy_credits',
  'view_existing_file',
  'merge_changes',
] as const;

export type ErrorAction = (typeof ERROR_ACTIONS)[number];
