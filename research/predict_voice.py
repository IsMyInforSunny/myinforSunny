"""Offline research prediction for cross-runtime checks on retained real articles.

This does not release a model or change runtime configuration.
"""
import argparse
import json
from pathlib import Path
from train_stance import read_rows
from train_voice import feature_text, selective_predictions
from voice_features import is_boilerplate


def predict(model, corpus):
    import numpy as np
    from scipy.sparse import csr_matrix
    from sklearn.feature_extraction.text import CountVectorizer
    output = []
    for article in corpus:
        topic = article['topicId']
        weights = model.get('topics', {}).get(topic)
        if not weights:
            continue
        units = article['sentences']
        vectorizer = CountVectorizer(analyzer='char', ngram_range=(2, 4), lowercase=False,
                                     vocabulary=weights['vectorizer']['vocabulary'])
        features = vectorizer.transform([feature_text(unit['text'], units[i-1]['text'] if i else '',
            units[i+1]['text'] if i+1 < len(units) else '') for i, unit in enumerate(units)]).astype(float)
        features.data = 1 + np.log(features.data)
        features = features.multiply(np.array(weights['vectorizer']['idf'])).tocsr()
        norms = np.sqrt(np.asarray(features.multiply(features).sum(axis=1)).ravel())
        inverse = np.divide(1., norms, out=np.zeros_like(norms), where=norms != 0)
        features = csr_matrix(features.multiply(inverse[:, None]))
        heads = selective_predictions(weights, features)
        labels = []
        for index, unit in enumerate(units):
            if is_boilerplate(unit['text']):
                labels.append({'sentenceId': unit['sentenceId'], 'direction': 'neutral', 'speaker': 'unknown',
                               'issue': 'none', 'excluded': True})
                continue
            direction = heads['direction'][index] or 'uncertain'
            speaker = heads['speaker'][index] or 'unknown'
            issue = heads['issue'][index] or 'unknown'
            if issue == 'unknown' or speaker == 'unknown' or direction in ['support', 'oppose'] and issue == 'none':
                direction = 'uncertain'
            labels.append({'sentenceId': unit['sentenceId'], 'direction': direction, 'speaker': speaker, 'issue': issue})
        output.append({'articleId': article['id'], 'labels': labels})
    return output


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', required=True)
    parser.add_argument('--corpus', required=True)
    args = parser.parse_args()
    model = json.loads(Path(args.model).read_text(encoding='utf-8-sig'))
    print(json.dumps(predict(model, read_rows(args.corpus)), ensure_ascii=True))
