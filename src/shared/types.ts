export type FieldType =
  | "text"
  | "email"
  | "tel"
  | "url"
  | "number"
  | "date"
  | "select"
  | "checkbox"
  | "radio"
  | "textarea";

export interface SelectOption {
  value: string;
  label: string;
}

export interface FormField {
  id: string;
  label: string;
  type: FieldType;
  required: boolean;
  options: SelectOption[];
}

export interface SourceCitation {
  document_id: string;
  title: string;
  excerpt: string;
}

export interface FillSuggestion {
  field_id: string;
  proposed_value: string;
  confidence: number;
  source: SourceCitation | null;
  needs_review: boolean;
  reason: string | null;
}

export interface ExtensionSettings {
  apiUrl: string;
  allowedOrigins: string[];
  tenantId: string;
  clientId: string;
  scopes: string;
  userEmail: string;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  apiUrl: "http://127.0.0.1:8000",
  allowedOrigins: [],
  tenantId: "",
  clientId: "",
  scopes: "",
  userEmail: "parveezbackup@gmail.com"
};

export type WorkerRequest =
  | { type: "SCAN_ACTIVE_TAB" }
  | { type: "FILL_FIELD"; fieldId: string; value: string }
  | { type: "FILL_ALL_FIELDS"; items: Array<{ fieldId: string; value: string }> }
  | { type: "GET_SETTINGS" }
  | { type: "SAVE_SETTINGS"; settings: ExtensionSettings }
  | { type: "SIGN_IN" }
  | { type: "SIGN_OUT" };

export type WorkerResponse =
  | { ok: true; fields?: FormField[]; suggestions?: FillSuggestion[]; settings?: ExtensionSettings; message?: string; filledCount?: number }
  | { ok: false; error: string };
