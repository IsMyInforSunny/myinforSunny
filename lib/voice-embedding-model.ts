import {z} from 'zod/v4';
import {VOICE_TOPICS,VOICE_VERSION,VOICE_SCOPE} from './sentence-voice';
import {DENSE_VOICE_DIMENSIONS,DENSE_VOICE_MARGIN_GAP} from './voice-dense';

// No artifact import here: server code separately supplies a release candidate.
const finite=z.number().finite();
const score=finite.min(0).max(1);
const count=z.number().int().nonnegative();
const positive=count.min(1);
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const head=z.object({classes:z.array(z.string()).min(2),
  coefficients:z.array(z.array(finite).length(DENSE_VOICE_DIMENSIONS)),
  intercepts:z.array(finite)}).strict();
const counts=z.object({neutral:positive,oppose:positive,support:positive}).strict();
const recalls=z.object({neutral:score,oppose:score.min(.5),support:score.min(.5)}).strict();
const runtimeHead=z.object({acceptedCount:count,abstainedCount:count,coverage:score,
  macroF1:score.min(.6),jointMacroF1:score.min(.6)}).strict();
const evaluation=z.object({schemaVersion:z.literal('voice-embedding-evaluation-1.0'),inputDigest:hash,
  humanEvaluationCount:z.literal(0),ready:z.literal(true),measuredPerformanceGatesPassed:z.literal(true),
  blockers:z.array(z.string()).length(0),maskingAgreement:score.min(.95),maskingCheckCount:positive,
  maskingVariantCount:positive.optional(),maskingMethod:z.string().min(1).optional(),
  configuration:z.object({embeddingModel:z.literal('nvidia/nemotron-3.5-embed-1b'),dimensions:z.literal(2048),
    normalization:z.literal('l2'),C:finite.positive(),classWeight:z.literal('balanced'),
    minimumMarginGap:z.literal(DENSE_VOICE_MARGIN_GAP),directionStrategy:z.literal('hierarchical'),
    selection:z.string().min(1)}).strict(),
  trainingCount:positive,heldoutCount:positive,trainingDirectionCounts:counts,heldoutDirectionCounts:counts,
  groupOverlap:z.literal(0),rawMacroF1:score.min(.6),majorityMacroF1:score,rawRecall:recalls,
  rawConfusion:z.array(z.array(count).length(3)).length(3),
  speakerMacroF1:score.min(.6),issueMacroF1:score.min(.6),
  runtime:z.object({minimumMarginGap:z.literal(DENSE_VOICE_MARGIN_GAP),count:positive,
    jointUsableCount:positive,jointCoverage:score,jointCorrectCount:count,jointAccuracy:score,
    macroF1:score.min(.6),supportRecall:score.min(.5),opposeRecall:score.min(.5),
    heads:z.object({direction:runtimeHead,speaker:runtimeHead,issue:runtimeHead}).strict()}).strict(),
  flipChallenge:z.object({pairAccuracy:score.min(.5),pairCount:count.min(10),
    itemAccuracy:score.min(.5),abstainedCount:count}).strict(),meaning:z.string().min(1),
}).strict();
const bundle=z.object({schemaVersion:z.literal('sentence-voice-embedding-svm-1.0'),status:z.literal('ready'),
  version:z.string().trim().min(1),definitionVersion:z.literal(VOICE_VERSION),segmenter:z.literal('sentence-3.1'),
  scopeCharacters:z.literal(VOICE_SCOPE),encoder:z.object({version:z.literal('voice-semantic-1.0'),
    provider:z.literal('nvidia'),model:z.literal('nvidia/nemotron-3.5-embed-1b'),dimensions:z.literal(2048),
    inputType:z.literal('passage'),normalization:z.literal('l2')}).strict(),
  topics:z.record(z.string(),z.object({heads:z.object({directionality:head,polarity:head,speaker:head,issue:head}).strict(),evaluation}).strict()),
  trainingArticleHashes:z.array(hash).min(1),release:z.object({schemaVersion:z.literal('voice-embedding-release-1.0'),
    corpusDigest:hash,labelsDigest:hash,reviewDigest:hash,modelDigest:hash,vectorsDigest:hash,inputDigest:hash,
    trainingAllowed:z.literal(true),modelDistributionAllowed:z.literal(true)}).strict(),
}).strict();

export type EmbeddingVoiceModel=z.infer<typeof bundle>;
const close=(left:number,right:number)=>Math.abs(left-right)<1e-9;

/** Validates release shape and numeric evidence; metrics describe AI-teacher
 * agreement. This does not establish human accuracy or independently grant rights.
 */
export function parseEmbeddingVoiceModel(value:unknown):EmbeddingVoiceModel|null {
  const parsed=bundle.safeParse(value);
  if(!parsed.success)return null;
  const model=parsed.data;
  if(!Object.keys(model.topics).length||new Set(model.trainingArticleHashes).size!==model.trainingArticleHashes.length)return null;
  for(const [topic,item] of Object.entries(model.topics)) {
    if(!Object.hasOwn(VOICE_TOPICS,topic))return null;
    const expected={directionality:['directional','neutral'],polarity:['oppose','support'],
      speaker:['journalist','source'],issue:[...Object.keys(VOICE_TOPICS[topic as keyof typeof VOICE_TOPICS].issues),'none']};
    for(const name of ['directionality','polarity','speaker','issue'] as const) {
      const current=item.heads[name],allowed=expected[name];
      if(current.classes.length!==allowed.length||new Set(current.classes).size!==current.classes.length||
        current.classes.some(label=>!allowed.includes(label))||current.coefficients.length!==current.classes.length||
        current.intercepts.length!==current.classes.length||!current.coefficients.some(row=>row.some(weight=>weight!==0)))return null;
    }
    const ev=item.evaluation,rt=ev.runtime,flip=ev.flipChallenge;
    if(ev.inputDigest!==model.release.inputDigest||ev.rawMacroF1<=ev.majorityMacroF1||rt.macroF1<=ev.majorityMacroF1||
      rt.count!==ev.heldoutCount||Object.values(ev.trainingDirectionCounts).reduce((a,b)=>a+b,0)!==ev.trainingCount||
      Object.values(ev.heldoutDirectionCounts).reduce((a,b)=>a+b,0)!==ev.heldoutCount||
      rt.jointUsableCount>rt.count||rt.jointCorrectCount>rt.jointUsableCount||
      !close(rt.jointCoverage,rt.jointUsableCount/rt.count)||!close(rt.jointAccuracy,rt.jointCorrectCount/rt.jointUsableCount)||
      Object.values(rt.heads).some(h=>h.acceptedCount+h.abstainedCount!==rt.count||h.acceptedCount<rt.jointUsableCount||
        !close(h.coverage,h.acceptedCount/rt.count))||flip.abstainedCount>flip.pairCount*2)return null;
    const directionCounts=['neutral','oppose','support'] as const;
    if(ev.rawConfusion.some((row,index)=>row.reduce((a,b)=>a+b,0)!==ev.heldoutDirectionCounts[directionCounts[index]]||
      !close(row[index]/ev.heldoutDirectionCounts[directionCounts[index]],ev.rawRecall[directionCounts[index]])))return null;
    // The reported runtime headline is the joint usable direction-head score.
    if(!close(rt.macroF1,rt.heads.direction.jointMacroF1))return null;
  }
  return model;
}
