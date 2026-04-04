# -*- coding: utf-8 -*-
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

text = Path("lib/l10n/app_localizations.dart").read_text(encoding="utf-8")
m = re.search(r"'en':\s*\{(.*?)\n    \},\n    'zh':", text, re.DOTALL)
en_keys = []
for k in re.findall(r"'([^']+)':", m.group(1)):
    if k not in en_keys:
        en_keys.append(k)

from inject_es_locale import ES_MAP
sk = list(ES_MAP.keys())
missing = [k for k in en_keys if k not in ES_MAP]
extra = [k for k in sk if k not in en_keys]
print("en", len(en_keys), "ES_MAP", len(ES_MAP))
print("missing", len(missing), missing)
print("extra", len(extra), extra)
