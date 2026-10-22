export const MIN_FILL_CONFIDENCE = 0.65;

export function canApproveValue(confidence: number, proposedValue: string, editedValue: string): boolean {
  return editedValue.trim().length > 0 &&
    (confidence >= MIN_FILL_CONFIDENCE || editedValue !== proposedValue);
}
