// One save, start to finish: replay the operations, apply the automatic
// fields, validate the file and the business rules. Used by the server for
// every write and by the editor to show errors before sending.
import type { DocumentId } from "./documents";
import { normalizeDocument } from "./normalize";
import { applyOps, type Conflict, type Op, type Touched } from "./ops";
import { checkRules, type RuleContext, type RuleIssue } from "./rules";
import { validateDocument } from "./schemas";

export interface EditResult {
  content: Record<string, unknown>;
  conflicts: Conflict[];
  errors: RuleIssue[];
  warnings: RuleIssue[];
  touched: Touched[];
}

export async function processEdit(doc: DocumentId, original: Record<string, unknown>, ops: Op[], ctx: RuleContext = {}): Promise<EditResult> {
  const applied = await applyOps(doc, original, ops);
  const content = normalizeDocument(doc, applied.content);
  const schemaIssues = validateDocument(doc, content);
  const rules = checkRules(doc, content, applied.touched, ctx);
  return {
    content,
    conflicts: applied.conflicts,
    errors: [...schemaIssues, ...rules.errors],
    warnings: rules.warnings,
    touched: applied.touched,
  };
}
