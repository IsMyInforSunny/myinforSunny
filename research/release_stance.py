"""Reproduce and release a passing content SVM; never approve corpus permissions.

The supplied corpus must already carry training/model-distribution permissions.
An explicit review must identify the exact corpus and labels, with a public basis.
Neither a CLI flag nor a successful classifier evaluation grants those rights.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
from urllib.parse import urlparse

from train_stance import ROOT, digest, public_status, read_rows, train


def checked_release(corpus, labels, candidate, review, events=None):
    if not isinstance(candidate, dict) or candidate.get('status') != 'ready':
        raise ValueError('Research or missing model cannot be released')
    if not isinstance(review, dict):
        raise ValueError('A completed usage review is required')
    if (review.get('corpusDigest') != digest(corpus)
            or review.get('labelsDigest') != digest(labels)
            or review.get('trainingAllowed') is not True
            or review.get('modelDistributionAllowed') is not True
            or not isinstance(review.get('reviewedBy'), str)
            or not review['reviewedBy'].strip()):
        raise ValueError('Usage review must match the exact corpus and labels')
    basis = urlparse(review.get('basisUrl', ''))
    if basis.scheme != 'https' or not basis.hostname or basis.username or basis.password:
        raise ValueError('Usage review requires a public HTTPS basis')
    try:
        reviewed = datetime.fromisoformat(review.get('reviewedAt', '').replace('Z', '+00:00'))
    except (ValueError, TypeError):
        raise ValueError('Usage review requires a valid review date') from None
    if reviewed.tzinfo is None or reviewed > datetime.now(timezone.utc):
        raise ValueError('Usage review date must not be missing a timezone or in the future')
    reproduced, report = train(corpus, labels, event_groups=events)
    if not report['ready'] or not reproduced or reproduced != candidate:
        raise ValueError('Model failed independent reproduction or release checks: '
                         + ', '.join(report['blockers']))
    # No article text, quotations, URLs, reviewer identity or credentials enter
    # the portable artifact. Keep only hashes of review provenance.
    artifact = {**reproduced, 'release': {
        'schemaVersion': 'stance-release-1.0',
        'corpusDigest': digest(corpus), 'labelsDigest': digest(labels),
        'reviewDigest': digest(review),
        'modelDigest': digest(reproduced),
        'trainingAllowed': True, 'modelDistributionAllowed': True,
    }}
    return artifact, public_status(report)


def atomic_json(path, value):
    temporary = path.with_suffix(path.suffix + '.release-tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    temporary.replace(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('corpus', 'labels', 'candidate', 'usage-review'):
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--event-groups')
    args = parser.parse_args()
    load = lambda path: json.loads(Path(path).read_text(encoding='utf-8-sig'))
    events = load(args.event_groups) if args.event_groups else None
    if events and 'articleGroups' in events:
        events = events['articleGroups']
    artifact, status = checked_release(read_rows(args.corpus), read_rows(args.labels),
                                       load(args.candidate), load(args.usage_review), events)
    # All validation happens before either deployed source file is touched.
    atomic_json(ROOT / 'lib/data/stance-model.json', artifact)
    atomic_json(ROOT / 'lib/data/stance-model-status.json', status)
    print(json.dumps({'released': True, 'version': artifact['version'],
                      'artifactSha256': hashlib.sha256(json.dumps(artifact, ensure_ascii=False,
                          separators=(',', ':')).encode()).hexdigest()}))


if __name__ == '__main__':
    main()
