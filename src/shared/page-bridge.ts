import type { FieldType, FormField, SelectOption } from "./types";

export function scanFormFields(): FormField[] {
  const supportedInputTypes = ["text", "email", "tel", "url", "number", "date", "checkbox", "radio"];

  const GENERIC_LABELS = new Set([
    "single line text",
    "multi line text",
    "enter your answer",
    "enter your response",
    "unlabeled field",
    "answer",
    "text",
    "input"
  ]);

  function isGeneric(text: string): boolean {
    return GENERIC_LABELS.has(text.trim().toLowerCase());
  }

  function getMSFormsQuestionTitle(element: Element): string {
    const questionItem = element.closest(
      '[data-automation-id="questionItem"], [role="listitem"], .office-form-question, div[class*="question"]'
    );
    if (!questionItem) return "";

    // 1. Try dedicated title element in MS Forms
    const titleEl = questionItem.querySelector(
      '[data-automation-id="questionTitle"], [class*="question-title"], [class*="titleText"], .office-form-question-title'
    );
    if (titleEl && titleEl.textContent?.trim()) {
      return titleEl.textContent.trim().replace(/^(\d+[\.\)]\s*)/, "");
    }

    // 2. Extract leading lines before options
    const lines = (questionItem.textContent || "")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !/^(\d+[\.\)])$/.test(l));

    if (lines.length > 0) {
      const candidate = lines[0].replace(/^(\d+[\.\)]\s*)/, "");
      if (!isGeneric(candidate)) return candidate;
    }

    return "";
  }

  function accessibleLabel(element: Element): string {
    // 1. Check aria-labelledby first
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      const text = labelledBy.split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
        .filter(Boolean)
        .join(" ");
      if (text && !isGeneric(text)) return text;
    }

    // 2. Check aria-label (only if not generic like "Single line text")
    const ariaLabel = element.getAttribute("aria-label");
    if (ariaLabel && !isGeneric(ariaLabel)) return ariaLabel.trim();

    // 3. For radio/checkbox in MS Forms, check the direct option label or container
    if (element instanceof HTMLInputElement && (element.type === "radio" || element.type === "checkbox")) {
      const optionLabel = element.closest("label") || element.parentElement;
      const text = optionLabel?.textContent?.trim();
      if (text && !isGeneric(text)) return text;
    }

    // 4. Associated <label>
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
      const associated = element.labels
        ? Array.from(element.labels).map((label) => label.textContent?.trim() ?? "").filter(Boolean).join(" ")
        : "";
      if (associated && !isGeneric(associated)) return associated;

      // 5. Microsoft Forms question container fallback
      const msQuestion = getMSFormsQuestionTitle(element);
      if (msQuestion) return msQuestion;

      const placeholder = element.getAttribute("placeholder")?.trim() ?? "";
      if (placeholder && !isGeneric(placeholder)) return placeholder;
    }

    // 6. Generic container lookup
    const fallbackQuestion = getMSFormsQuestionTitle(element);
    if (fallbackQuestion) return fallbackQuestion;

    return "";
  }

  function optionsFor(
    control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
    group: Element[]
  ): SelectOption[] {
    if (control instanceof HTMLSelectElement) {
      return Array.from(control.options)
        .filter((option) => option.value && option.value.trim().length > 0)
        .map((option) => ({
          value: option.value.trim(),
          label: (option.label || option.textContent || option.value).trim()
        }));
    }
    if (control instanceof HTMLInputElement && control.type === "radio") {
      return group.map((member) => {
        const val = (member as HTMLInputElement).value || "";
        const lbl = accessibleLabel(member) || val;
        return { value: val, label: lbl };
      });
    }
    if (control instanceof HTMLInputElement && control.type === "checkbox") {
      return [
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" }
      ];
    }
    return [];
  }

  const controls = Array.from(
    document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      "input, textarea, select"
    )
  );
  const fields: FormField[] = [];
  const seenRadioNames = new Map<HTMLFormElement | null, Set<string>>();
  let sequence = 0;

  for (const control of controls) {
    if (control instanceof HTMLInputElement && (control.disabled || control.readOnly)) continue;
    if (control instanceof HTMLTextAreaElement && (control.disabled || control.readOnly)) continue;
    if (control instanceof HTMLSelectElement && control.disabled) continue;
    if (control instanceof HTMLInputElement) {
      const type = control.type.toLowerCase();
      if (!supportedInputTypes.includes(type)) continue;
      if (type === "radio" && control.name) {
        const form = control.closest("form");
        const names = seenRadioNames.get(form) ?? new Set<string>();
        if (names.has(control.name)) continue;
        names.add(control.name);
        seenRadioNames.set(form, names);
      }
    }

    const id = `embassy-field-${sequence++}`;
    const group = control instanceof HTMLInputElement && control.type === "radio" && control.name
      ? controls.filter((candidate) =>
          candidate instanceof HTMLInputElement &&
          candidate.type === "radio" &&
          candidate.name === control.name &&
          candidate.closest("form") === control.closest("form")
        )
      : [control];
    for (const member of group) member.setAttribute("data-embassy-field-id", id);

    const label = group
      .map(accessibleLabel)
      .filter(Boolean)
      .join("; ") || control.getAttribute("name") || control.id || "Unlabeled field";
    const options = optionsFor(control, group);
    const type: FieldType = control instanceof HTMLTextAreaElement
      ? "textarea"
      : control instanceof HTMLSelectElement
        ? "select"
        : control instanceof HTMLInputElement
          ? control.type.toLowerCase() as FieldType
          : "text";

    fields.push({
      id,
      label,
      type,
      required: group.some((member) => "required" in member && member.required),
      options
    });
  }

  return fields;
}

export function fillFormField(fieldId: string, value: string): boolean {
  function dispatchFieldEvents(element: HTMLElement): void {
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function highlight(element: HTMLElement): void {
    element.dataset.embassyFilled = "true";
    element.style.outline = "2px solid #167a58";
    element.style.outlineOffset = "2px";
  }

  const members = Array.from(
    document.querySelectorAll<HTMLElement>("[data-embassy-field-id]")
  ).filter((element) => element.getAttribute("data-embassy-field-id") === fieldId);
  if (members.length === 0) return false;

  const first = members[0];

  if (first instanceof HTMLInputElement && first.type === "radio") {
    const selected = members.find((member) => (member as HTMLInputElement).value === value);
    if (!(selected instanceof HTMLInputElement)) return false;
    selected.checked = true;
    dispatchFieldEvents(selected);
    highlight(selected);
    return true;
  }

  if (first instanceof HTMLInputElement && first.type === "checkbox") {
    const norm = value.trim().toLowerCase();
    if (!["yes", "no", "true", "false", "1", "0"].includes(norm)) return false;
    first.checked = ["yes", "true", "1"].includes(norm);
    dispatchFieldEvents(first);
    highlight(first);
    return true;
  }

  if (first instanceof HTMLSelectElement) {
    first.value = value;
    dispatchFieldEvents(first);
    highlight(first);
    return true;
  }

  if (first instanceof HTMLInputElement || first instanceof HTMLTextAreaElement) {
    const proto = Object.getPrototypeOf(first);
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    if (descriptor && descriptor.set) {
      descriptor.set.call(first, value);
    } else {
      first.value = value;
    }
    dispatchFieldEvents(first);
    highlight(first);
    return true;
  }

  return false;
}

export function submitFormOnPage(): boolean {
  // 1. Look for MS Forms explicit submit button
  const msSubmit = document.querySelector<HTMLButtonElement | HTMLElement>(
    '[data-automation-id="submitButton"], button[data-automation-id*="submit"], button.office-form-bottom-button'
  );
  if (msSubmit) {
    msSubmit.click();
    return true;
  }

  // 2. Look for standard submit buttons / input[type="submit"]
  const submitBtn = document.querySelector<HTMLButtonElement | HTMLInputElement>(
    'button[type="submit"], input[type="submit"]'
  );
  if (submitBtn) {
    submitBtn.click();
    return true;
  }

  // 3. Fallback: Search for buttons containing text "submit", "send", "apply"
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("button"));
  const candidate = buttons.find((btn) => {
    const text = btn.innerText?.trim().toLowerCase() ?? "";
    return text === "submit" || text === "send" || text.includes("submit");
  });
  if (candidate) {
    candidate.click();
    return true;
  }

  // 4. Try native form submit
  const form = document.querySelector("form");
  if (form) {
    form.requestSubmit ? form.requestSubmit() : form.submit();
    return true;
  }

  return false;
}
