import stored from '../data/precomputed-voices.json';
import {z} from 'zod/v4';
import {SEGMENTER} from '../segmentation';
import {validateVoiceDocument,voiceArticleHash,voiceLabelSchema,VOICE_ARTICLE_ISSUE,VOICE_SCOPE,VOICE_VERSION,type VoiceDocument,type VoiceTopic} from '../sentence-voice';

const artifactSchema=z.object({
  schemaVersion:z.literal('precomputed-voices-1.0'),
  researchOnly:z.literal(false),
  usageReviewed:z.literal(true),
  modelVersion:z.string().min(1),
  decisionPolicy:z.string().min(1),
  issuePolicy:z.literal(VOICE_ARTICLE_ISSUE),
  definitionVersion:z.literal(VOICE_VERSION),
  segmenter:z.literal(SEGMENTER),
  scopeCharacters:z.literal(VOICE_SCOPE),
  documents:z.record(z.string().regex(/^[a-f0-9]{64}$/),z.unknown()),
});

export type PrecomputedVoiceExpectation={modelVersion:string;decisionPolicy:string;topic:VoiceTopic;articleIssue:string};

/** Only reviewed server artifacts matching the current model may skip inference.
 * Coordinates are rebuilt with the current publication/event metadata. */
export async function readPrecomputedVoiceDocument(body:string,expected:PrecomputedVoiceExpectation,artifact:unknown=stored):Promise<VoiceDocument|null>{
  const parsed=artifactSchema.safeParse(artifact);
  if(!parsed.success||parsed.data.modelVersion!==expected.modelVersion||parsed.data.decisionPolicy!==expected.decisionPolicy)return null;
  const candidate=parsed.data.documents[await voiceArticleHash(body)];
  if(!candidate||typeof candidate!=='object'||Array.isArray(candidate))return null;
  const document=candidate as VoiceDocument;
  if(document.method!=='svm'||document.modelVersion!==expected.modelVersion||document.topic!==expected.topic
    ||document.articleIssue!==expected.articleIssue||document.issuePolicy!==VOICE_ARTICLE_ISSUE
    ||(document.decisionPolicy??'voice-joint-1.0')!==expected.decisionPolicy||!Array.isArray(document.labels))return null;
  if(!z.array(voiceLabelSchema).safeParse(document.labels).success)return null;
  const validated=validateVoiceDocument(body,document);
  if(!validated||validated.labels.length!==document.labels.length||validated.labels.some((label,index)=>{
    const original=document.labels[index];
    return ['sentenceId','issue','direction','speaker','excluded'].some(key=>label[key as keyof typeof label]!==original[key as keyof typeof original]);
  }))return null;
  return structuredClone(validated);
}
