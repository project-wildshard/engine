import { parseDecisionScripts, type DecisionScriptRow } from '../../src/sharddev/decisionScripts';
import { encodeCanonicalJson } from '../../src/shared/host/immutable';

function matchesAdmitted(input: unknown, admitted: DecisionScriptRow): input is DecisionScriptRow {
  return encodeCanonicalJson(input) === encodeCanonicalJson(admitted);
}

/** Preserve an original wire's ordering only after complete admission and value equality.
 * Defaults, removed fields and every semantic change must refuse instead of changing a pin. */
export function originalScriptOrder(input: unknown, current: DecisionScriptRow): DecisionScriptRow {
  const admitted = parseDecisionScripts([input])[0];
  if (admitted === undefined || !matchesAdmitted(input, admitted)
    || encodeCanonicalJson(admitted) !== encodeCanonicalJson(current)) throw new Error('Original script metadata differs');
  return structuredClone(input);
}
