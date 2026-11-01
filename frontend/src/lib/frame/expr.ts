/**
 * Tiny arithmetic for frame coordinates: numbers, parameter names, + - * / and parentheses.
 * Mirrors backend/app/services/frame/expr.py; keep the two in step.
 */

import { enFrame } from "./i18n";

export type ExprErrorKey = "notFinite" | "tooLong" | "unexpectedEnd" | "divisionByZero" | "tooDeep" | "unknownParam" | "missingClose"
  | "unexpected" | "empty" | "notFiniteResult" | "tooFar";

/** A bad expression. `key` and `values` name the message (frame.expr.*), so it can be shown in any language. */
export class ExprError extends Error {
  constructor(readonly key: ExprErrorKey, readonly values: Record<string, string> = {}) {
    super(enFrame(`expr.${key}`, values));
  }
}

const MAX_LENGTH = 200;
const MAX_DEPTH = 32;

type Token = { kind: "num" | "name" | "op"; value: string };

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  const re = /\s*(?:(\d+(?:\.\d*)?|\.\d+)|([A-Za-z_][A-Za-z0-9_]*)|(.))/gy;
  let m: RegExpExecArray | null;
  while (re.lastIndex < src.length && (m = re.exec(src))) {
    if (m[1]) out.push({ kind: "num", value: m[1] });
    else if (m[2]) out.push({ kind: "name", value: m[2] });
    else if (m[3] && m[3].trim()) out.push({ kind: "op", value: m[3] });
  }
  return out;
}

export function evaluate(src: number | string, params: Record<string, number>): number {
  if (typeof src === "number") {
    if (!Number.isFinite(src)) throw new ExprError("notFinite");
    return src;
  }
  if (src.length > MAX_LENGTH) throw new ExprError("tooLong", { max: String(MAX_LENGTH) });
  const tokens = tokenize(src.trim());
  let pos = 0;
  let depth = 0;
  const peek = () => tokens[pos];
  const take = () => {
    if (pos >= tokens.length) throw new ExprError("unexpectedEnd", { src });
    return tokens[pos++];
  };

  const expr = (): number => {
    let v = term();
    for (let t = peek(); t && t.kind === "op" && (t.value === "+" || t.value === "-"); t = peek()) {
      take();
      v = t.value === "+" ? v + term() : v - term();
    }
    return v;
  };
  const term = (): number => {
    let v = factor();
    for (let t = peek(); t && t.kind === "op" && (t.value === "*" || t.value === "/"); t = peek()) {
      take();
      const rhs = factor();
      if (t.value === "*") v *= rhs;
      else {
        if (rhs === 0) throw new ExprError("divisionByZero", { src });
        v /= rhs;
      }
    }
    return v;
  };
  const factor = (): number => {
    if (++depth > MAX_DEPTH) throw new ExprError("tooDeep");
    try {
      return factorInner();
    } finally {
      depth--;
    }
  };
  const factorInner = (): number => {
    const { kind, value } = take();
    if (kind === "num") return Number(value);
    if (kind === "name") {
      if (!(value in params)) throw new ExprError("unknownParam", { name: value });
      return params[value];
    }
    if (value === "-") return -factor();
    if (value === "(") {
      const v = expr();
      const close = take();
      if (close.kind !== "op" || close.value !== ")") throw new ExprError("missingClose", { src });
      return v;
    }
    throw new ExprError("unexpected", { token: value, src });
  };

  if (!tokens.length) throw new ExprError("empty");
  const value = expr();
  if (pos !== tokens.length) throw new ExprError("unexpected", { token: tokens[pos].value, src });
  if (!Number.isFinite(value)) throw new ExprError("notFiniteResult", { src });
  return value;
}
