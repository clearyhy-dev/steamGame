# -*- coding: utf-8 -*-
import re
from pathlib import Path

text = Path("lib/l10n/app_localizations.dart").read_text(encoding="utf-8")

def keys_in_block(label, end_marker):
    m = re.search(
        rf"'{label}':\s*\{{(.*?)\n    \}},\n    '{end_marker}':",
        text,
        re.DOTALL,
    )
    if not m:
        return []
    return re.findall(r"'([^']+)':", m.group(1))

en = []
for k in keys_in_block("en", "zh"):
    if k not in en:
        en.append(k)

for lang, nxt in [("fr", "ru"), ("es", "ur")]:
    have = set(keys_in_block(lang, nxt))
    missing = [k for k in en if k not in have]
    print(lang, "have", len(have), "missing", len(missing))
