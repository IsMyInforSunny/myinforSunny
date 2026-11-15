import type {EmbeddingVoiceModel} from '../voice-embedding-model';

/** Vite's explicit loopback-only research plugin replaces this module in serve
 * mode. This is never a release artifact and the production build stays null. */
export type VoiceEmbeddingInferenceModel=Pick<EmbeddingVoiceModel,'version'|'decisionPolicy'|'encoder'|'topics'|'trainingArticleHashes'>;
const localResearchVoice:VoiceEmbeddingInferenceModel|null=null;
export default localResearchVoice;
