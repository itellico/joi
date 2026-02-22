// Core tools always available to every agent (mirrors gateway/src/agent/tools.ts)
export const CORE_TOOLS = new Set([
  "memory_search", "memory_store", "memory_manage",
  "document_search", "current_datetime",
  "schedule_create", "schedule_list", "schedule_manage",
  "spawn_agent", "review_request", "review_status",
  "query_gateway_logs", "skill_read",
]);

const SKILL_TO_CAPABILITY: Record<string, string> = {
  // Email / Gmail
  gmail_search: "Email",
  gmail_read: "Email",
  gmail_send: "Email",
  google_accounts_list: "Email",
  // Accounting Gmail tools
  gmail_scan: "Accounting",
  gmail_download: "Accounting",
  gmail_get_html: "Accounting",
  gmail_mark_processed: "Accounting",
  // Calendar
  calendar_list_calendars: "Calendar",
  calendar_list_events: "Calendar",
  calendar_create_event: "Calendar",
  calendar_update_event: "Calendar",
  calendar_delete_event: "Calendar",
  // Contacts
  contacts_search: "Contacts",
  contacts_get: "Contacts",
  contacts_list: "Contacts",
  contacts_groups: "Contacts",
  contacts_group_members: "Contacts",
  contacts_interactions_list: "Contacts",
  contacts_update_extra: "Contacts",
  // Messaging
  channel_send: "Messaging",
  channel_list: "Messaging",
  // Obsidian
  obsidian_search: "Obsidian",
  obsidian_read: "Obsidian",
  obsidian_write: "Obsidian",
  obsidian_list: "Obsidian",
  // Wiki (Outline)
  outline_search: "Wiki",
  outline_read: "Wiki",
  outline_list_collections: "Wiki",
  // Transcription
  youtube_transcribe: "Transcription",
  audio_transcribe: "Transcription",
  // Code
  run_claude_code: "Code",
  // Drive
  drive_upload: "Drive",
  drive_list: "Drive",
  // Invoices
  invoice_save: "Invoices",
  invoice_classify: "Invoices",
  invoice_list: "Invoices",
  // Banking
  transaction_import: "Banking",
  transaction_match: "Banking",
  transaction_list: "Banking",
  reconciliation_run: "Banking",
  // Tasks (Things3)
  tasks_list: "Tasks",
  tasks_create: "Tasks",
  tasks_complete: "Tasks",
  tasks_update: "Tasks",
  tasks_move: "Tasks",
  tasks_projects: "Tasks",
  tasks_logbook: "Tasks",
  tasks_create_project: "Tasks",
  // OKRs
  okr_score_all: "OKRs",
  okr_report: "OKRs",
  okr_sync_things3: "OKRs",
  okr_things3_progress: "OKRs",
  okr_checkin: "OKRs",
  // Store
  store_create_collection: "Store",
  store_list_collections: "Store",
  store_create_object: "Store",
  store_query: "Store",
  store_update_object: "Store",
  store_delete_object: "Store",
  store_relate: "Store",
  store_search: "Store",
  store_audit: "Store",
  // Skills
  skill_audit: "Skills",
  skill_scan_joi: "Skills",
  skill_scan_claude_code: "Skills",
  skill_scan_official: "Skills",
  skill_scan_agents: "Skills",
  // Codebase
  codebase_tree: "Codebase",
  codebase_read: "Codebase",
  codebase_migrations: "Codebase",
  // Knowledge
  knowledge_sync_status: "Knowledge",
  // Documents (core, but also a capability)
  document_search: "Documents",
};

// Reverse mapping: capability → tool names
export const CAPABILITY_TO_SKILLS: Record<string, string[]> = {};
for (const [skill, cap] of Object.entries(SKILL_TO_CAPABILITY)) {
  (CAPABILITY_TO_SKILLS[cap] ||= []).push(skill);
}

export function getCapabilities(skills: string[]): string[] {
  const caps = new Set<string>();
  for (const skill of skills) {
    const cap = SKILL_TO_CAPABILITY[skill];
    if (cap) caps.add(cap);
  }
  return Array.from(caps);
}

// Get the capability name for a given tool
export function getToolCapability(tool: string): string | undefined {
  return SKILL_TO_CAPABILITY[tool];
}

// Get all unique capability names
export function getAllCapabilities(): string[] {
  return Object.keys(CAPABILITY_TO_SKILLS).sort();
}
