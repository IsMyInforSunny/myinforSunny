import { capabilities, runtimeConfig } from '@/lib/server/config';
import { json } from '@/lib/server/errors';
import {releasedVoiceModel,releasedEmbeddingVoiceModel} from '@/lib/server/voice-analysis';
export async function GET(){return json({...capabilities(await runtimeConfig()),biasModel:{
  ready:!!(releasedVoiceModel||releasedEmbeddingVoiceModel),
  method:releasedEmbeddingVoiceModel?'embedding_svm':releasedVoiceModel?'sentence_svm':null,
  version:releasedEmbeddingVoiceModel?.version??releasedVoiceModel?.version??null,
  topics:[...new Set([...Object.keys(releasedVoiceModel?.topics??{}),...Object.keys(releasedEmbeddingVoiceModel?.topics??{})])],
  comparisonMinimum:{articlesPerPublisher:3,publishers:2},
}});}
