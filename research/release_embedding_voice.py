"""Reproduce a semantic-SVM release; never grant article/model permissions.

No API calls. Default CLI output remains local. Writing a source artifact needs
both successful validation and an explicit --write-source invocation.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import subprocess
import sys
import tempfile
from urllib.parse import urlparse

from train_stance import ROOT, digest, normalize, read_rows, article_prefix
from prepare_voice_embeddings import natural_text, local_path, MODEL
from release_stance import atomic_json

PUBLISHERS = ['데일리안', '뉴데일리', '오마이뉴스', '프레시안']


def masking_summary(prepared):
    """Actual-input invariance, not a fairness/accuracy or new API experiment."""
    records = prepared.get('records')
    if not isinstance(records, list) or not records:
        raise ValueError('Actual prepared sentence records required for masking check')
    identical, variants = 0, 0
    for record in records:
        if not isinstance(record, dict) or not isinstance(record.get('text'), str) or not record['text'].strip():
            raise ValueError('Masking check needs nonempty actual sentences')
        text = natural_text(record['text'])
        if hashlib.sha256(text.encode()).hexdigest() != record.get('key'):
            raise ValueError('Prepared actual sentence key mismatch')
        for publisher in PUBLISHERS:
            variants += 1
            identical += natural_text(publisher + ' ' + record['text'] + ' ' + publisher) == text
    return {'maskingAgreement': identical / variants, 'maskingCheckCount': len(records),
            'maskingVariantCount': variants, 'identicalInputVariantCount': identical,
            'method': 'Actual normalized input is identical after adding each of four publisher names; the same cached vector is used. No new embedding/API request.',
            'humanEvaluationCount': 0}


def validate_usage_review(corpus, labels, prepared, review):
    if (not isinstance(review, dict) or review.get('corpusDigest') != digest(corpus)
            or review.get('labelsDigest') != digest(labels) or review.get('trainingAllowed') is not True
            or review.get('modelDistributionAllowed') is not True
            or not isinstance(review.get('reviewedBy'), str) or not review['reviewedBy'].strip()):
        raise ValueError('Usage review must identify the exact corpus/labels and existing permissions')
    if not isinstance(review.get('basisUrl'), str):
        raise ValueError('A public HTTPS usage basis is required')
    basis = urlparse(review['basisUrl'])
    if basis.scheme != 'https' or not basis.hostname or basis.username or basis.password:
        raise ValueError('A public HTTPS usage basis is required')
    try:
        stamp = datetime.fromisoformat(review.get('reviewedAt', '').replace('Z', '+00:00'))
    except (ValueError, TypeError, AttributeError):
        raise ValueError('A valid usage review timestamp is required') from None
    if stamp.tzinfo is None or stamp > datetime.now(timezone.utc):
        raise ValueError('Usage review timestamp is missing its timezone or is in the future')
    sets = prepared.get('sets', {})
    if set(sets) != {'train', 'evaluation', 'challenge'}:
        raise ValueError('Prepared source partitions are missing')
    selected = {row['articleId'] for rows in sets.values() for row in rows}
    by_id = {article['id']: article for article in corpus}
    if not selected or selected - by_id.keys():
        raise ValueError('Prepared source articles do not exist in the reviewed corpus')
    if any(by_id[article_id].get('usage', {}).get('trainingAllowed') is not True
           or by_id[article_id].get('usage', {}).get('modelDistributionAllowed') is not True for article_id in selected):
        raise ValueError('Selected training/evaluation/challenge source permissions remain unapproved')
    return selected


def _reproduce(corpus, labels, prepared, vectors, events, split_manifest, challenge):
    """Reuse the fixed preparer/evaluator, including frozen hashes and grounding.

    Re-evaluating this exact fixed candidate is release reproduction; no setting
    is selected using its outer result and no existing report is overwritten.
    """
    runtime = ROOT / '.sites-runtime'
    runtime.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='embedding-release-check-', dir=runtime) as temporary:
        directory = Path(temporary).resolve()
        if not directory.is_relative_to(runtime.resolve()):
            raise ValueError('Reproduction directory escaped local runtime')
        def write(name, value, jsonl=False):
            path = directory / name
            text = (''.join(json.dumps(row, ensure_ascii=False) + '\n' for row in value) if jsonl
                    else json.dumps(value, ensure_ascii=False))
            path.write_text(text, encoding='utf-8')
            return str(path)
        corpus_path, labels_path = write('corpus.jsonl', corpus, True), write('labels.jsonl', labels, True)
        event_path = write('events.json', events or {})
        split_path, challenge_path = write('split.json', split_manifest), write('challenge.json', challenge)
        prepared_path, vectors_path = str(directory / 'prepared.json'), write('vectors.json', vectors)
        candidate_path, report_path = str(directory / 'candidate.json'), str(directory / 'report.json')
        try:
            subprocess.run([sys.executable, '-X', 'utf8', str(ROOT / 'research/prepare_voice_embeddings.py'),
                '--corpus', corpus_path, '--labels', labels_path, '--events', event_path,
                '--split-manifest', split_path, '--challenge', challenge_path, '--output', prepared_path],
                cwd=ROOT, capture_output=True, text=True, encoding='utf-8', check=True, timeout=120)
            reproduced_input = json.loads(Path(prepared_path).read_text(encoding='utf-8'))
            if reproduced_input != prepared:
                raise ValueError('Prepared partitions, grounding, labels or source digests failed exact reproduction')
            subprocess.run([sys.executable, '-X', 'utf8', str(ROOT / 'research/evaluate_voice_embeddings.py'),
                '--input', prepared_path, '--vectors', vectors_path, '--candidate', candidate_path, '--report', report_path],
                cwd=ROOT, capture_output=True, text=True, encoding='utf-8', check=True, timeout=120)
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
            raise ValueError('Offline input/model reproduction failed; no artifact was released') from None
        return json.loads(Path(candidate_path).read_text(encoding='utf-8')), json.loads(Path(report_path).read_text(encoding='utf-8'))


def _fraction(value, name):
    if type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= 1:
        raise ValueError('Invalid reproduced metric: ' + name)
    return value


def require_performance(report, prepared, masking):
    """Recheck actual numbers rather than trusting ready/pass/blocker flags."""
    macro = _fraction(report.get('rawMacroF1'), 'rawMacroF1')
    majority = _fraction(report.get('majorityMacroF1'), 'majorityMacroF1')
    if macro < .6 or macro <= majority:
        raise ValueError('Reproduced teacher agreement is below threshold')
    if any(_fraction(report.get('rawRecall', {}).get(label), label + ' recall') < .5 for label in ['support', 'oppose']):
        raise ValueError('Reproduced direction recall is below threshold')
    if min(_fraction(report.get(name), name) for name in ['speakerMacroF1', 'issueMacroF1']) < .6:
        raise ValueError('Reproduced speaker/issue agreement is below threshold')
    runtime = report.get('runtime', {})
    if runtime.get('minimumMarginGap') != .15 or runtime.get('count') != len(prepared['sets']['evaluation']):
        raise ValueError('Reproduced runtime uses a different margin/scope')
    runtime_macro = _fraction(runtime.get('macroF1'), 'runtime macroF1')
    if runtime_macro < .6 or runtime_macro <= majority:
        raise ValueError('Reproduced runtime agreement is below threshold')
    if any(_fraction(runtime.get(label + 'Recall'), 'runtime ' + label) < .5 for label in ['support', 'oppose']):
        raise ValueError('Reproduced runtime direction recall is below threshold')
    if min(_fraction(runtime.get('heads', {}).get(name, {}).get('jointMacroF1'), name + ' joint F1') for name in ['speaker', 'issue']) < .6:
        raise ValueError('Reproduced runtime speaker/issue agreement is below threshold')
    flips = report.get('flipChallenge', {})
    if flips.get('pairCount', 0) < 10 or _fraction(flips.get('pairAccuracy'), 'opposite-pair accuracy') < .5:
        raise ValueError('Reproduced independent opposite-pair challenge failed')
    if report.get('groupOverlap') != 0 or len({row['articleId'] for row in prepared['sets']['evaluation']}) < 2:
        raise ValueError('Reproduced independent heldout grouping is insufficient')
    counts = Counter(row['direction'] for row in prepared['sets']['train'])
    if any(counts[label] < 10 for label in ['neutral', 'oppose', 'support']):
        raise ValueError('Selected training classes have insufficient samples')
    if _fraction(masking.get('maskingAgreement'), 'publisher masking') < .95:
        raise ValueError('Publisher input masking failed')


def checked_release(corpus, labels, prepared, vectors, candidate, usage_review,
                    events=None, split_manifest=None, challenge=None):
    if (not isinstance(candidate, dict) or candidate.get('schemaVersion') != 'voice-embedding-svm-research-1.0'
            or candidate.get('status') != 'research'):
        raise ValueError('A real semantic-SVM research candidate is required')
    if not isinstance(prepared, dict) or prepared.get('schemaVersion') != 'voice-embedding-input-1.0':
        raise ValueError('Prepared actual-article input is required')
    payload = {key: value for key, value in prepared.items() if key != 'inputDigest'}
    if prepared.get('inputDigest') != digest(payload) or candidate.get('inputDigest') != prepared['inputDigest']:
        raise ValueError('Prepared/candidate input digest mismatch')
    validate_usage_review(corpus, labels, prepared, usage_review)
    reproduced, report = _reproduce(corpus, labels, prepared, vectors, events, split_manifest, challenge)
    if reproduced != candidate:
        raise ValueError('Candidate weights, version, configuration or evaluation failed exact reproduction')
    masking = masking_summary(prepared)
    require_performance(report, prepared, masking)
    evaluation = {**report, 'ready': True, 'blockers': [], 'maskingAgreement': masking['maskingAgreement'],
        'maskingCheckCount': masking['maskingCheckCount'], 'maskingVariantCount': masking['maskingVariantCount'],
        'maskingMethod': masking['method']}
    train_ids = {row['articleId'] for row in prepared['sets']['train']}
    hashes = sorted({hashlib.sha256(normalize(article_prefix(article['text'])).encode()).hexdigest()
                     for article in corpus if article['id'] in train_ids})
    artifact = {'schemaVersion': 'sentence-voice-embedding-svm-1.0', 'status': 'ready', 'version': candidate['version'],
        'definitionVersion': 'sentence-voice-1.0', 'segmenter': 'sentence-3.1', 'scopeCharacters': 2000,
        'encoder': {'version': 'voice-semantic-1.0', 'provider': 'nvidia', 'model': MODEL,
                    'dimensions': 2048, 'inputType': 'passage', 'normalization': 'l2'},
        'topics': {'nuclear_energy': {'heads': candidate['heads'], 'evaluation': evaluation}},
        'trainingArticleHashes': hashes,
        'release': {'schemaVersion': 'voice-embedding-release-1.0', 'corpusDigest': digest(corpus),
                    'labelsDigest': digest(labels), 'reviewDigest': digest(usage_review),
                    'modelDigest': digest(candidate), 'vectorsDigest': digest(vectors), 'inputDigest': prepared['inputDigest'],
                    'trainingAllowed': True, 'modelDistributionAllowed': True}}
    return artifact, evaluation


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['corpus', 'labels', 'prepared', 'vectors', 'candidate', 'usage-review', 'events', 'split-manifest', 'challenge', 'output']:
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--write-source', action='store_true', help='Explicitly write the validated artifact to lib/data/voice-embedding-model.json')
    args = parser.parse_args()
    load = lambda value: json.loads(local_path(value).read_text(encoding='utf-8-sig'))
    events = load(args.events)
    artifact, report = checked_release(read_rows(local_path(args.corpus)), read_rows(local_path(args.labels)),
        load(args.prepared), load(args.vectors), load(args.candidate), load(args.usage_review),
        events.get('articleGroups', events), load(args.split_manifest), load(args.challenge))
    output = local_path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    atomic_json(output, artifact)
    if args.write_source:
        atomic_json(ROOT / 'lib/data/voice-embedding-model.json', artifact)
    print(json.dumps({'validated': True, 'sourceWritten': args.write_source, 'version': artifact['version'],
                      'maskingAgreement': report['maskingAgreement'], 'humanEvaluationCount': 0}))


if __name__ == '__main__':
    main()
