"""Tiny arithmetic for frame coordinates: numbers, parameter names, + - * / and parentheses.

Mirrored in frontend/src/lib/frame/expr.ts; keep the two in step.
"""

import re

_TOKEN = re.compile(r"\s*(?:(\d+(?:\.\d*)?|\.\d+)|([A-Za-z_][A-Za-z0-9_]*)|(.))")


class ExprError(ValueError):
    pass


def evaluate(src: float | int | str, params: dict[str, float]) -> float:
    if isinstance(src, (int, float)):
        return float(src)
    tokens: list[tuple[str, str]] = []
    for num, name, op in _TOKEN.findall(src.strip()):
        if num:
            tokens.append(("num", num))
        elif name:
            tokens.append(("name", name))
        elif op.strip():
            tokens.append(("op", op))
    pos = 0

    def peek() -> tuple[str, str] | None:
        return tokens[pos] if pos < len(tokens) else None

    def take() -> tuple[str, str]:
        nonlocal pos
        if pos >= len(tokens):
            raise ExprError(f"Unexpected end of {src!r}")
        pos += 1
        return tokens[pos - 1]

    def expr() -> float:
        v = term()
        while (t := peek()) and t[1] in "+-" and t[0] == "op":
            take()
            v = v + term() if t[1] == "+" else v - term()
        return v

    def term() -> float:
        v = factor()
        while (t := peek()) and t[1] in "*/" and t[0] == "op":
            take()
            rhs = factor()
            if t[1] == "*":
                v *= rhs
            else:
                if rhs == 0:
                    raise ExprError(f"Division by zero in {src!r}")
                v /= rhs
        return v

    def factor() -> float:
        kind, val = take()
        if kind == "num":
            return float(val)
        if kind == "name":
            if val not in params:
                raise ExprError(f"Unknown parameter {val!r}")
            return params[val]
        if val == "-":
            return -factor()
        if val == "(":
            v = expr()
            if take() != ("op", ")"):
                raise ExprError(f"Missing ')' in {src!r}")
            return v
        raise ExprError(f"Unexpected {val!r} in {src!r}")

    if not tokens:
        raise ExprError("Empty expression")
    value = expr()
    if pos != len(tokens):
        raise ExprError(f"Unexpected {tokens[pos][1]!r} in {src!r}")
    return value
