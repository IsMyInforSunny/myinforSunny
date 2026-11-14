"""Release sentence SVM only after exact reproduction and documented source review."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
from urllib.parse import urlparse
from train_stance import ROOT, digest, read_rows
from train_voice import train
from release_stance import atomic_json


def checked_release(corpus, labels, candidate, review, events=None, challenge=None, split_manifest=None):
    if not candidate or candidate.get('status') != 'ready':
        raise ValueError('Research model cannot be released')
    if (not isinstance(review, dict) or review.get('corpusDigest') != digest(corpus)
            or review.get('labelsDigest') != digest(labels) or review.get('trainingAllowed') is not True
            or review.get('modelDistributionAllowed') is not True or not str(review.get('reviewedBy', '')).strip()):
        raise ValueError('Exact corpus/labels usage review required')
    basis = urlparse(review.get('basisUrl', ''))
    if basis.scheme != 'https' or not basis.hostname or basis.username or basis.password:
        raise ValueError('Public usage-review basis required')
    stamp = datetime.fromisoformat(review.get('reviewedAt', '').replace('Z', '+00:00'))
    if stamp.tzinfo is None or stamp > datetime.now(timezone.utc):
        raise ValueError('Invalid review timestamp')
    reproduced, report = train(corpus, labels, event_groups=events, challenge=challenge, split_manifest=split_manifest)
    if not report['ready'] or reproduced != candidate:
        raise ValueError('Reproduction or validation failed')
    return {**reproduced, 'release': {'schemaVersion': 'voice-release-1.0', 'corpusDigest': digest(corpus),
        'labelsDigest': digest(labels), 'reviewDigest': digest(review), 'modelDigest': digest(reproduced),
        'trainingAllowed': True, 'modelDistributionAllowed': True}}, report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['corpus', 'labels', 'candidate', 'usage-review', 'challenge']:
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--event-groups')
    parser.add_argument('--split-manifest')
    args = parser.parse_args()
    load = lambda path: json.loads(Path(path).read_text(encoding='utf-8-sig')) if path else None
    events = load(args.event_groups)
    if events and 'articleGroups' in events:
        events = events['articleGroups']
    artifact, report = checked_release(read_rows(args.corpus), read_rows(args.labels), load(args.candidate),
                                       load(args.usage_review), events, load(args.challenge), load(args.split_manifest))
    atomic_json(ROOT / 'lib/data/voice-model.json', artifact)
    atomic_json(ROOT / 'lib/data/voice-model-status.json', {'schemaVersion': 'sentence-voice-training-status-1.0',
                'version': artifact['version'], 'ready': True, 'candidateReady': True,
                'annotatedArticleCount': report['annotatedArticles'], 'usableSentenceCount': report['usableSentences'],
                'humanEvaluationCount': 0, 'teacher': report['teacher'], 'blockers': [], 'topics': report['topics']})
    print(json.dumps({'released': True, 'version': artifact['version']}))


if __name__ == '__main__':
    main()
