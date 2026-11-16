"""Count independent review overlap without exposing article text or identifiers.

The tool deliberately does not infer consensus from disjoint examples. It emits
blocked-but-auditable retraining and after-diagnosis artifacts when there are
no jointly reviewed sentence IDs.
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA = ROOT / ".sites-runtime" / "voice-expansion-20261115"
DEFAULT_OUT = ROOT / "docs" / "test-runs"
TARGET_TOPICS = ("medical_school_quota", "nuclear_energy", "minimum_wage")
FIELDS = ("issue", "direction", "speaker")


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8-sig").splitlines() if line.strip()]


def read_group(directory: Path, prefix: str) -> list[dict[str, Any]]:
    return [row for name in (f"{prefix}.local.jsonl", f"{prefix}-additional.local.jsonl")
            for row in read_jsonl(directory / name)]


def sentence_index(rows: list[dict[str, Any]]) -> tuple[dict[tuple[str, str], tuple[dict[str, Any], dict[str, Any]]], int]:
    indexed: dict[tuple[str, str], tuple[dict[str, Any], dict[str, Any]]] = {}
    duplicate = 0
    for row in rows:
        article_id = row.get("articleId")
        for label in row.get("labels", []):
            sentence_id = label.get("sentenceId")
            if not isinstance(article_id, str) or not isinstance(sentence_id, str):
                continue
            key = (article_id, sentence_id)
            if key in indexed:
                duplicate += 1
                continue
            indexed[key] = (row, label)
    return indexed, duplicate


def _file_digest(paths: list[Path]) -> str:
    digest = hashlib.sha256()
    for path in paths:
        digest.update(path.name.encode())
        digest.update(path.read_bytes())
    return digest.hexdigest()


def diagnose(directory: Path, frozen_path: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    files_a = [directory / "review-a.local.jsonl", directory / "review-a-additional.local.jsonl"]
    files_b = [directory / "review-b.local.jsonl", directory / "review-b-additional.local.jsonl"]
    a_rows, b_rows = read_group(directory, "review-a"), read_group(directory, "review-b")
    a_index, a_duplicates = sentence_index(a_rows)
    b_index, b_duplicates = sentence_index(b_rows)
    shared = a_index.keys() & b_index.keys()
    field_agreement = {field: {"compared": 0, "agree": 0} for field in FIELDS}
    complete_agreement = 0
    topic_pairs: Counter[str] = Counter()
    topic_complete: Counter[str] = Counter()
    valid_pairs_by_topic: dict[str, set[tuple[str, str]]] = {}
    complete_pairs_by_topic: dict[str, set[tuple[str, str]]] = {}
    for key in shared:
        a_row, a_label = a_index[key]
        b_row, b_label = b_index[key]
        if a_row.get("articleHash") != b_row.get("articleHash") or a_row.get("topic") != b_row.get("topic"):
            continue
        topic = a_row.get("topic", "unknown")
        topic_pairs[topic] += 1
        valid_pairs_by_topic.setdefault(topic, set()).add(key)
        all_agree = True
        for field in FIELDS:
            av, bv = a_label.get(field), b_label.get(field)
            if av is None or bv is None:
                all_agree = False
                continue
            field_agreement[field]["compared"] += 1
            if av == bv:
                field_agreement[field]["agree"] += 1
            else:
                all_agree = False
        if all_agree:
            complete_agreement += 1
            topic_complete[topic] += 1
            complete_pairs_by_topic.setdefault(topic, set()).add(key)

    frozen = json.loads(frozen_path.read_text(encoding="utf-8-sig"))
    evaluation_counts: dict[str, dict[str, int]] = {}
    for topic in TARGET_TOPICS:
        split = frozen.get("topics", {}).get(topic, {})
        eval_ids = set(split.get("evaluationArticleIds", []))
        consensus_pairs = sum(1 for article_id, _sentence_id in valid_pairs_by_topic.get(topic, set())
                             if article_id in eval_ids)
        evaluation_counts[topic] = {
            "frozenEvaluationArticles": len(eval_ids),
            "jointlyReviewedEvaluationSentences": consensus_pairs,
            "consensusEvaluationSentences": sum(1 for article_id, _sentence_id in complete_pairs_by_topic.get(topic, set())
                                                if article_id in eval_ids),
        }

    annotators_a = sorted({json.dumps(row.get("annotator", {}), sort_keys=True) for row in a_rows})
    annotators_b = sorted({json.dumps(row.get("annotator", {}), sort_keys=True) for row in b_rows})
    target_counts = {
        topic: {
            "reviewAArticles": len({row.get("articleId") for row in a_rows if row.get("topic") == topic}),
            "reviewBArticles": len({row.get("articleId") for row in b_rows if row.get("topic") == topic}),
            "sharedArticleIds": len({row.get("articleId") for row in a_rows if row.get("topic") == topic}
                                     & {row.get("articleId") for row in b_rows if row.get("topic") == topic}),
            "sharedSentenceIds": topic_pairs.get(topic, 0),
            "completeConsensusSentences": topic_complete.get(topic, 0),
            **evaluation_counts[topic],
        }
        for topic in TARGET_TOPICS
    }
    input_paths = files_a + files_b + [frozen_path]
    input_digest = _file_digest(input_paths)
    generated = datetime.now(timezone.utc).isoformat(timespec="seconds")
    block = not complete_agreement
    retrain = {
        "schemaVersion": "voice-retrain-preflight-2026-11-16-1.0",
        "generatedAt": generated,
        "researchOnly": True,
        "apiCalls": 0,
        "inputDigest": input_digest,
        "reviewFiles": [path.name for path in input_paths[:4]],
        "reviewAArticles": len({row.get("articleId") for row in a_rows}),
        "reviewBArticles": len({row.get("articleId") for row in b_rows}),
        "reviewASentenceAnnotations": len(a_index),
        "reviewBSentenceAnnotations": len(b_index),
        "sharedArticleIds": len({row.get("articleId") for row in a_rows}
                                & {row.get("articleId") for row in b_rows}),
        "sharedArticleSentencePairs": sum(topic_pairs.values()),
        "duplicateAnnotations": {"reviewA": a_duplicates, "reviewB": b_duplicates},
        "annotators": {"reviewA": annotators_a, "reviewB": annotators_b,
                       "independenceDemonstrated": bool(annotators_a and annotators_b and annotators_a != annotators_b)},
        "fieldAgreement": field_agreement,
        "completeConsensusSentences": complete_agreement,
        "topics": target_counts,
        "status": "blocked_insufficient_joint_review" if block else "ready_for_reviewed_training",
        "trainingStarted": False,
        "candidateCreated": False,
        "scores": None,
        "blocker": "A and B contain no shared article-hash and sentence-ID pairs; no field consensus can be formed."
                if block else None,
        "meaning": "No consensus or model-quality claim is inferred from labels on different articles.",
    }
    after = {
        "schemaVersion": "bias-diagnosis-2026-11-16-after-1.0",
        "generatedAt": generated,
        "researchOnly": True,
        "apiCalls": 0,
        "sourceInputDigest": input_digest,
        "status": "not_run_no_consensus_candidate" if block else "pending_model_retraining",
        "modelChanged": False,
        "coordinateRecalculation": "not_run",
        "comparisonToBefore": "not_comparable_no_retrained_candidate",
        "topics": target_counts,
        "beforeMetricsCopied": False,
        "meaning": "After metrics are intentionally null; existing candidate results are not relabeled as retrained results.",
    }
    return retrain, after


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--frozen-split", type=Path, default=DEFAULT_DATA / "six-topics-frozen-split.local.json")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    retrain, after = diagnose(args.data, args.frozen_split)
    (args.out / "retrain-2026-11-16.json").write_text(json.dumps(retrain, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (args.out / "bias-diagnosis-2026-11-16-after.json").write_text(json.dumps(after, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": retrain["status"], "sharedPairs": retrain["sharedArticleSentencePairs"],
                      "consensus": retrain["completeConsensusSentences"], "apiCalls": 0}, ensure_ascii=True))


if __name__ == "__main__":
    main()
