"""Shared, versioned feature rules for Python/TypeScript voice SVM encoders."""
import json
import re
from pathlib import Path

from train_stance import normalize

FEATURES = json.loads((Path(__file__).resolve().parent.parent / 'lib/data/voice-features.json').read_text(encoding='utf-8'))
if (FEATURES.get('version') != 'voice-features-1.0'
        or not isinstance(FEATURES.get('boilerplatePatterns'), list)
        or not isinstance(FEATURES.get('replacements'), list)):
    raise ValueError('Invalid shared voice feature definition')
FEATURES_VERSION = FEATURES['version']
BOILERPLATE = [re.compile(pattern, re.I) for pattern in FEATURES['boilerplatePatterns']]
REPLACEMENTS = [(re.compile(pattern, re.I), replacement) for pattern, replacement in FEATURES['replacements']]
PUBLISHERS = re.compile(r'데일리안|뉴데일리|오마이뉴스|프레시안|(?:www\.)?(?:dailian|newdaily|ohmynews|pressian)\.(?:co\.kr|com)', re.I)


def model_text(text):
    value = PUBLISHERS.sub('', text)
    for pattern, replacement in REPLACEMENTS:
        value = pattern.sub(replacement, value)
    return normalize(value)


def is_boilerplate(text):
    return any(pattern.search(text.strip()) for pattern in BOILERPLATE)
