import { capabilities, runtimeConfig } from '@/lib/server/config';
import { json } from '@/lib/server/errors';
import {releasedVoiceModel,releasedEmbeddingVoiceModel} from '@/lib/server/voice-analysis';
import {researchVoiceInjected} from '@/lib/server/voice-embedding';
export async function GET(){const config=await runtimeConfig();return json({...capabilities(config),biasModel:{
  ready:!!(releasedVoiceModel||releasedEmbeddingVoiceModel),
  method:releasedEmbeddingVoiceModel?'embedding_svm':releasedVoiceModel?'sentence_svm':null,
  version:releasedEmbeddingVoiceModel?.version??releasedVoiceModel?.version??null,
  topics:[...new Set([...Object.keys(releasedVoiceModel?.topics??{}),...Object.keys(releasedEmbeddingVoiceModel?.topics??{})])],
  ...(researchVoiceInjected?{researchInjected:true}:{}),
  comparisonMinimum:{articlesPerPublisher:3,publishers:2},
},supportedArticleHosts:config.ALLOWED_RETRIEVAL_HOSTS?.split(',').map(host=>host.trim().toLowerCase()).filter(Boolean)??[]});}
