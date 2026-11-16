import json
from pathlib import Path
import tempfile
import unittest

from diagnose_voice_consensus import diagnose


def write_rows(path: Path, rows):
    path.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")


def row(article_id, topic, sentence_id, direction="support", speaker="journalist", annotator="A"):
    return {
        "articleId": article_id, "articleHash": f"hash-{article_id}", "topic": topic,
        "annotator": {"kind": "ai", "model": annotator, "version": "review-v1"},
        "labels": [{"sentenceId": sentence_id, "issue": topic, "direction": direction, "speaker": speaker}],
    }


class ConsensusDiagnosticTests(unittest.TestCase):
    def test_disjoint_reviews_are_blocked_without_inventing_consensus(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            write_rows(root / "review-a.local.jsonl", [row("a1", "medical_school_quota", "s1")])
            write_rows(root / "review-a-additional.local.jsonl", [])
            write_rows(root / "review-b.local.jsonl", [row("b1", "medical_school_quota", "s1", annotator="B")])
            write_rows(root / "review-b-additional.local.jsonl", [])
            frozen = root / "frozen.json"
            frozen.write_text(json.dumps({"topics": {"medical_school_quota": {"evaluationArticleIds": ["a1"]}}}), encoding="utf-8")

            retrain, after = diagnose(root, frozen)

            self.assertEqual(retrain["sharedArticleSentencePairs"], 0)
            self.assertEqual(retrain["completeConsensusSentences"], 0)
            self.assertEqual(retrain["status"], "blocked_insufficient_joint_review")
            self.assertFalse(retrain["candidateCreated"])
            self.assertIsNone(retrain["scores"])
            self.assertEqual(after["coordinateRecalculation"], "not_run")
            self.assertFalse(after["beforeMetricsCopied"])

    def test_matching_sentence_hash_and_all_fields_is_counted_for_eval(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            write_rows(root / "review-a.local.jsonl", [row("a1", "medical_school_quota", "s1")])
            write_rows(root / "review-a-additional.local.jsonl", [])
            write_rows(root / "review-b.local.jsonl", [row("a1", "medical_school_quota", "s1", annotator="B")])
            write_rows(root / "review-b-additional.local.jsonl", [])
            frozen = root / "frozen.json"
            frozen.write_text(json.dumps({"topics": {"medical_school_quota": {"evaluationArticleIds": ["a1"]}}}), encoding="utf-8")

            retrain, _ = diagnose(root, frozen)

            self.assertEqual(retrain["completeConsensusSentences"], 1)
            self.assertEqual(retrain["topics"]["medical_school_quota"]["consensusEvaluationSentences"], 1)
            self.assertEqual(retrain["status"], "ready_for_reviewed_training")


if __name__ == "__main__":
    unittest.main()
