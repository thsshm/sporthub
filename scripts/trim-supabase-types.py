#!/usr/bin/env python3
"""
Trim the Supabase-generated TypeScript types down to what SportHub uses.

Why: `supabase gen types typescript --linked` emits the *entire* public
schema, including the PostGIS noise (spatial_ref_sys, geometry_columns and
~300 st_*/geometry_* helper functions). That bloats lib/supabase/types.ts to
~1600 lines of types we never call. This script keeps only the tables and RPC
functions the app actually uses, preserving the hand-written domain aliases.

Usage:
    supabase gen types typescript --linked > /tmp/types_gen.ts
    python3 scripts/trim-supabase-types.py /tmp/types_gen.ts

Reads the generated file (argv[1], default /tmp/types_gen.ts), trims it, and
rewrites lib/supabase/types.ts in place — keeping the existing header doc
comment and everything after the `/* ─` alias separator untouched.
"""
import re
import sys
from pathlib import Path

GEN_PATH = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("/tmp/types_gen.ts")
OUT_PATH = Path(__file__).resolve().parent.parent / "lib" / "supabase" / "types.ts"

KEEP_TABLES = {
    "amenity",
    "booking_link",
    "city",
    "claim_request",
    "country",
    "sport",
    "user_favorite",
    "venue",
    "venue_amenity",
    "venue_sport",
}
KEEP_FUNCS = {"venues_in_bbox"}

# A member starts at 6-space indentation: `      name: ...`
MEMBER = re.compile(r"^      (\w+):")
# A sub-block (Tables/Functions/etc.) closes at 4-space `    }`
SUBCLOSE = re.compile(r"^    \}")


def filter_members(lines, keep):
    """Keep only the named members in a Tables/Functions sub-block.

    `lines` is the body between the sub-block header and its closing brace.
    A member runs from its `      name:` line up to (but not including) the
    next member start or the sub-block close. This handles one-liner members,
    multi-line block members, and overload-union function members uniformly.
    """
    out = []
    i = 0
    n = len(lines)
    while i < n:
        m = MEMBER.match(lines[i])
        if not m:
            out.append(lines[i])
            i += 1
            continue
        name = m.group(1)
        start = i
        i += 1
        while i < n and not MEMBER.match(lines[i]) and not SUBCLOSE.match(lines[i]):
            i += 1
        if name in keep:
            out.extend(lines[start:i])
    return out


def trim_subblock(text, header, keep):
    """Trim a `header: {` ... `}` sub-block to only `keep` members."""
    pat = re.compile(r"(^    " + header + r": \{\n)(.*?)(^    \}\n)", re.M | re.S)

    def repl(match):
        body = match.group(2).splitlines(keepends=True)
        kept = filter_members(body, keep)
        if not kept:
            # Empty sub-block → satisfy the index signature shape.
            return match.group(1) + "      [_ in never]: never\n" + match.group(3)
        return match.group(1) + "".join(kept) + match.group(3)

    return pat.sub(repl, text)


def main():
    gen = GEN_PATH.read_text()

    # Strip the __InternalSupabase metadata block — not needed and references
    # a prerelease shape.
    gen = re.sub(
        r"^  __InternalSupabase: \{\n.*?^  \}\n", "", gen, flags=re.M | re.S
    )

    gen = trim_subblock(gen, "Tables", KEEP_TABLES)
    gen = trim_subblock(gen, "Functions", KEEP_FUNCS)

    # Views / CompositeTypes are unused → collapse to the empty shape.
    gen = re.sub(
        r"(^    Views: \{\n)(.*?)(^    \}\n)",
        r"\1      [_ in never]: never\n\3",
        gen,
        flags=re.M | re.S,
    )
    gen = re.sub(
        r"(^    CompositeTypes: \{\n)(.*?)(^    \}\n)",
        r"\1      [_ in never]: never\n\3",
        gen,
        flags=re.M | re.S,
    )

    # Preserve the current file's header doc comment + domain aliases.
    current = OUT_PATH.read_text()
    header_parts = re.split(r"(?m)^export type Json =", current, maxsplit=1)
    header = header_parts[0]
    alias_parts = current.split("/* ─", 1)
    aliases = "/* ─" + alias_parts[1] if len(alias_parts) > 1 else ""

    # The generated body: from `export type Json =` to the end of `Constants`.
    gen_body = re.search(r"(?ms)^export type Json =.*", gen)
    body = gen_body.group(0).rstrip() + "\n"

    OUT_PATH.write_text(header + body + ("\n" + aliases if aliases else ""))
    print(f"Wrote {OUT_PATH} ({len(OUT_PATH.read_text().splitlines())} lines)")


if __name__ == "__main__":
    main()
