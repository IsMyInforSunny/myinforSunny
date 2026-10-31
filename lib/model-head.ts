import {z} from 'zod/v4';

const vector=z.array(z.number().finite()).min(1).max(4096);
export const headSchema=z.object({
 schemaVersion:z.literal('svm-head-1.0'),task:z.literal('expression_binary'),
 labels:z.tuple([z.literal('clear'),z.literal('flagged')]),
 releaseStatus:z.enum(['synthetic-test-only','experimental-not-approved','approved']),
 encoderVersion:z.string().min(1),dimension:z.number().int().min(1).max(4096),
 scaler:z.object({mean:vector,scale:z.array(z.number().finite().positive()).min(1).max(4096)}),
 linear:z.object({weights:vector,bias:z.number().finite()}),
 calibration:z.object({method:z.literal('held-out-logistic-sigmoid'),weight:z.number().finite(),bias:z.number().finite()}),
 abstain:z.object({low:z.number().min(0).lt(.5),high:z.number().gt(.5).max(1)}),
 trainingDataHash:z.string().regex(/^[a-f0-9]{64}$/),
}).superRefine((h,context)=>{
 if([h.scaler.mean,h.scaler.scale,h.linear.weights].some(a=>a.length!==h.dimension))context.addIssue({code:'custom',message:'Model dimension mismatch'});
});
export type ModelHead=z.infer<typeof headSchema>;

/** Pure browser-compatible head inference. No fetch, API key, or generated explanation. */
export function inferHead(head:ModelHead,embedding:number[],encoderVersion:string){
 const h=headSchema.parse(head);
 if(encoderVersion!==h.encoderVersion||embedding.length!==h.dimension||embedding.some(v=>!Number.isFinite(v)))throw Error('ENCODER_MISMATCH');
 const margin=embedding.reduce((sum,v,i)=>sum+(v-h.scaler.mean[i])/h.scaler.scale[i]*h.linear.weights[i],h.linear.bias);
 if(!Number.isFinite(margin))throw Error('NUMERIC_OVERFLOW');
 const z=Math.max(-700,Math.min(700,margin*h.calibration.weight+h.calibration.bias));
 const probability=1/(1+Math.exp(-z));
 return {margin,probability,label:probability<=h.abstain.low?'clear' as const:probability>=h.abstain.high?'flagged' as const:'undetermined' as const,
   releaseStatus:h.releaseStatus,encoderVersion:h.encoderVersion};
}
