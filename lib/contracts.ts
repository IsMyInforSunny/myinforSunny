import { z } from 'zod/v4';

export const RUBRIC = 'rubric-4.0';
const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const text = (max: number) => z.string().max(max).refine(v => v.trim().length > 0, '내용을 입력해 주세요.');
export const analyzeRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('demo'), fixtureId: id }).strict(),
  z.object({ kind: z.literal('text'), body: text(2000), comments: z.array(z.object({ id, text: text(200) }).strict()).max(5), proposition: text(160).optional(), transmissionConsent:z.literal(true) }).strict(),
]);
export type TextRequest = Omit<Extract<z.infer<typeof analyzeRequestSchema>, {kind:'text'}>,'transmissionConsent'>;
export const spanSchema = z.object({ sourceId: id, sentenceId: id, start: z.number().int().nonnegative(), end: z.number().int().positive(), quote: text(8000) });
export type Span = z.infer<typeof spanSchema>;
export const sourceSchema = z.object({ id, clientId: id.optional(), kind: z.enum(['body','comment']), text: text(8000), sentences: z.array(z.object({ id, start:z.number().int().nonnegative(), end:z.number().int().positive(), natural:z.object({ index:z.number().int().nonnegative(), part:z.number().int().nonnegative(), parts:z.number().int().positive() }).optional() })).max(1000) });
export type InputSource = z.infer<typeof sourceSchema>;
export const claimSchema = z.object({ id, text: text(1000), kind: z.enum(['factual','opinion','undetermined']), origin: z.array(spanSchema).min(1).max(8), targetTime:z.string().max(100).optional() });
export type Claim = z.infer<typeof claimSchema>;
export const criteriaSchema = z.enum(['personal_attack','group_generalization','mockery','fear_appeal','overstatement','threat']);
export const expressionSchema = z.object({ sentenceId:id, sourceId:id, status:z.enum(['flagged','clear','undetermined']), criteria:z.array(criteriaSchema).max(6), severity:z.enum(['moderate','strong']).optional(), context:z.enum(['direct','quoted','irony','unclear']), explanation:z.string().max(1000).optional(), evidence:z.array(spanSchema).max(8) });
export type Expression = z.infer<typeof expressionSchema>;
export const stanceLabelSchema = z.enum(['support','oppose','mixed','not_expressed','undetermined']);
export type Ratio = { numerator:number; denominator:number; percent:number|null };
export type Topic = { id:string; label:string; description:string; evidence:Span[] };
export type TopicAssignment = { sourceId:string; topicIds:string[]; status:'assigned'|'other'|'undetermined'; evidence:Span[]; reason?:string };
/** One processing unit of the body. Complete only when every body unit has exactly one entry. */
export type BodyTopicAssignment = { sentenceId:string; topicIds:string[]; status:'assigned'|'other'|'undetermined'; reason?:string };
export type Stance = { sourceId:string; label:z.infer<typeof stanceLabelSchema>; evidence:Span[]; reason?:string };
export type CounterArgument = {claimId:string;kind:'counterpoint'|'qualification';text:string;reasoning:string;evidenceNeeded:string;basis:Span[];provenance:'ai_suggestion'|'curated_example'};
export const searchQuerySchema=z.string().trim().min(3).max(100).regex(/^[A-Za-z0-9]+(?:[ -][A-Za-z0-9]+)*$/,'영문 핵심어를 입력해 주세요.');
export type SearchSuggestion={label:string;query:string};
export type Analysis = {
  schemaVersion:'2.1'; analysisId:string; requestId:string; mode:'demo'|'live'; status:'success'|'partial';
  versions:{rubric:string;prompt:string;model:string;segmenter:string};
  sources:InputSource[]; proposition?:string; topics:Topic[]; topicAssignments:TopicAssignment[]; bodyTopicAssignments?:BodyTopicAssignment[]; stances?:Stance[];
  expressions:Expression[]; claims:Claim[]; perspectiveQuestions:{text:string;basis:Span[]}[];
  counterArguments?:CounterArgument[];searchSuggestions?:SearchSuggestion[];
  indicators:{topics:{topicId:string;coverage:Ratio}[];expression:Ratio;expressionUndetermined:number;evidenceSupport:Ratio;verificationProgress:Ratio};
  coverage:{totalSentences:number;naturalSentences?:number;factualClaimsExtracted:number;claimsMayBeOmitted:boolean;scopeNote:string};
  warnings:{code:string;message:string}[];createdAt:string;
};
export const referenceInputSchema = z.object({ id, text:text(1500).optional(), url:z.string().url().max(2048).refine(v=>/^https?:\/\//.test(v),'HTTP/HTTPS 주소만 지원합니다.').optional() }).strict().refine(v=>v.text || v.url,'자료 본문 또는 주소가 필요합니다.');
export const verifyRequestSchema = z.discriminatedUnion('kind',[
  z.object({kind:z.literal('demo'),fixtureId:id}).strict(),
  z.object({kind:z.literal('text'),parentAnalysisId:id.optional(),sources:z.array(sourceSchema).min(1).max(6),claims:z.array(claimSchema).min(1).max(1),references:z.array(referenceInputSchema).max(2),useWebSearch:z.literal(false),transmissionConsent:z.literal(true)}).strict(),
]);
export type VerifyTextRequest = Omit<Extract<z.infer<typeof verifyRequestSchema>,{kind:'text'}>,'transmissionConsent'>;
export type Reference = { id:string;provenance:'provided_text'|'web_fetched';text:string;url?:string;title?:string;publishedAt?:string;fetchedAt?:string;truncated:boolean;publisherGroup?:string;fullTextLength?:number;extractionVersion?:string;
 /** Server-owned digest of retrieved text before excerpting (not a digest of the displayed quote). */
  contentDigest?:string;retrievedTextLength?:number;retrievedTruncated?:boolean;
  /** Server-generated prediction over retrieved text before excerpting. */
  biasPrediction?:import('./bias-model').CompactBiasPrediction };
export const outcomeSchema = z.enum(['supported','contradicted','conflicting','insufficient','unchecked','inaccessible','not_applicable']);
export type Outcome = z.infer<typeof outcomeSchema>;
export type EvidenceRelation = { referenceId:string;quote:string;start:number;end:number;relation:'supports'|'contradicts'|'context';explanation:string };
export type Check = { claimId:string;outcome:Outcome;execution:'completed'|'failed'|'skipped';relations:EvidenceRelation[];explanation:string;temporalFit:'matched'|'mismatched'|'unclear';limitations:string[] };
export type Verification = {schemaVersion:'2.1';requestId:string;parentAnalysisId?:string;mode:'demo'|'live';status:'success'|'partial';versions:{rubric:string;prompt:string;model:string;retriever:string};scope:'provided_text'|'retrieved_documents'|'mixed';references:Reference[];checks:Check[];attempts:{url?:string;query?:string;status:string;reason?:string}[];warnings:{code:string;message:string}[];createdAt:string};
export type Capabilities = {searchProvider?:'gdelt'|'firecrawl';live:boolean;webSearch:boolean;webFetch:boolean;rubricVersion:string;limits:{body:number;comments:number;comment:number;claimsPerCheck:number};reason?:string};

// Model output is a proposal: offsets and final indicators are always server-owned.
const quoteCandidate=z.object({sentenceId:id,quote:text(8000)}).strict();
export const rawAnalysisSchema=z.object({
  topics:z.array(z.object({id,label:text(50),description:text(300),evidence:z.array(quoteCandidate).min(1).max(5)}).strict()).max(5),
  topicAssignments:z.array(z.object({sourceId:id,topicIds:z.array(id).max(5),status:z.enum(['assigned','other','undetermined']),evidence:z.array(quoteCandidate).max(5),reason:z.string().max(300)}).strict()).max(5),
  stances:z.array(z.object({sourceId:id,label:stanceLabelSchema,evidence:z.array(quoteCandidate).max(5),reason:z.string().max(300)}).strict()).max(5),
  // Compact body classification: every body unit id must appear exactly once across these three lists.
  bodyAssigned:z.array(z.object({sentenceId:id,topicIds:z.array(id).max(5)}).strict()).max(24),
  bodyOtherIds:z.array(id).max(24),
  bodyUndeterminedIds:z.array(id).max(24),
  expressions:z.array(z.object({sentenceId:id,status:z.enum(['flagged','clear','undetermined']),criteria:z.array(criteriaSchema).max(6),severity:z.enum(['moderate','strong','none']),context:z.enum(['direct','quoted','irony','unclear']),explanation:z.string().max(500),evidence:z.array(quoteCandidate).max(5)}).strict()).max(50),
  claims:z.array(z.object({id,text:text(1000),kind:z.enum(['factual','opinion','undetermined']),origin:z.array(quoteCandidate).min(1).max(5),targetTime:z.string().max(100)}).strict()).max(5),
  perspectiveQuestions:z.array(z.object({text:text(500),basis:z.array(quoteCandidate).min(1).max(5)}).strict()).max(2),
  counterArguments:z.array(z.object({claimId:id,kind:z.enum(['counterpoint','qualification','not_applicable']),text:text(350),reasoning:text(350),evidenceNeeded:text(250),basis:z.array(quoteCandidate).min(1).max(2)}).strict()).max(2),
  searchSuggestions:z.array(z.object({label:text(60),query:searchQuerySchema}).strict()).max(2),
  claimsMayBeOmitted:z.boolean(),
}).strict();
export type RawAnalysis=z.infer<typeof rawAnalysisSchema>;
export function analysisModelSchema(sources:InputSource[],hasProposition:boolean){
 const ids=sources.flatMap(s=>s.sentences.map(t=>t.id));
 const commentIds=sources.filter(s=>s.kind==='comment').map(s=>s.id);
 const sentenceId=z.enum(ids as [string,...string[]]);
 const commentId=commentIds.length?z.enum(commentIds as [string,...string[]]):id;
 const bodyUnits=sources.filter(s=>s.kind==='body').reduce((n,s)=>n+s.sentences.length,0);
 const quote=z.object({sentenceId:id,quote:text(8000)}).strict();
 return rawAnalysisSchema.extend({
  clearSentenceIds:z.array(sentenceId).max(ids.length),
  topics:z.array(rawAnalysisSchema.shape.topics.element.extend({evidence:z.array(quote).min(1).max(5)})).min(1).max(5),
  topicAssignments:z.array(rawAnalysisSchema.shape.topicAssignments.element.extend({sourceId:commentId,evidence:z.array(quote).max(5)})).length(commentIds.length),
  stances:z.array(rawAnalysisSchema.shape.stances.element.extend({sourceId:commentId,evidence:z.array(quote).max(5)})).length(hasProposition?commentIds.length:0),
  bodyAssigned:z.array(rawAnalysisSchema.shape.bodyAssigned.element).max(bodyUnits),
  bodyOtherIds:z.array(id).max(bodyUnits),
  bodyUndeterminedIds:z.array(id).max(bodyUnits),
  expressions:z.array(rawAnalysisSchema.shape.expressions.element.extend({sentenceId:id,evidence:z.array(quote).max(5)})).max(ids.length),
  claims:z.array(rawAnalysisSchema.shape.claims.element.extend({origin:z.array(quote).min(1).max(5)})).max(5),
  perspectiveQuestions:z.array(rawAnalysisSchema.shape.perspectiveQuestions.element.extend({basis:z.array(quote).min(1).max(5)})).max(2),
  counterArguments:z.array(rawAnalysisSchema.shape.counterArguments.element.extend({basis:z.array(quote).min(1).max(2)})).min(1).max(2),
 });
}
export const rawVerificationSchema=z.object({checks:z.array(z.object({claimId:id,originMatches:z.boolean(),outcome:outcomeSchema,relations:z.array(z.object({referenceId:id,quote:text(8000),relation:z.enum(['supports','contradicts','context']),explanation:text(1000)}).strict()).max(10),explanation:text(1000),temporalFit:z.enum(['matched','mismatched','unclear']),limitations:z.array(z.string().max(500)).max(8)}).strict()).max(2)}).strict();

export const LABELS:Record<string,string>={support:'찬성',oppose:'반대',mixed:'혼합',not_expressed:'명시 없음',undetermined:'판단 유보',supported:'출처에서 확인됨 · 입력 자료 기준',contradicted:'입력한 출처와 다름',conflicting:'입력 자료 간 내용이 다름',insufficient:'추가 근거 필요',unchecked:'미대조',inaccessible:'접근 실패',not_applicable:'확인 대상 아님',personal_attack:'인신공격',group_generalization:'집단 일반화',mockery:'조롱',fear_appeal:'공포 유도',overstatement:'과도한 단정',threat:'위협'};
