import {z} from 'zod/v4';
import {claimSchema,sourceSchema,searchQuerySchema} from './contracts';
import type {Check,Reference,Verification} from './contracts';

export type ResearchStage='not_started'|'planning'|'searching'|'fetching'|'waiting'|'comparing'|'completed'|'partial'|'unavailable'|'failed'|'cancelled';
export const researchInputSchema=z.object({sources:z.array(sourceSchema).min(1).max(6),claims:z.array(claimSchema).max(5),position:claimSchema.optional(),proposition:z.string().trim().min(1).max(160).optional(),transmissionConsent:z.literal(true),researchConsent:z.literal(true)}).strict().refine(v=>v.claims.length>0||v.position?.kind==='opinion'||!!v.proposition,'조사할 사실 주장·의견이나 비교 명제가 필요합니다.');
export type ResearchInput=z.infer<typeof researchInputSchema>;
export const researchQuerySchema=z.object({claimId:z.string().min(1).max(64),label:z.string().min(1).max(100),query:searchQuerySchema,purpose:z.enum(['fact_check','perspective'])}).strict();
export type ResearchQuery=z.infer<typeof researchQuerySchema>;
export type ResearchPlan={schemaVersion:'research-1.0';planId:string;token:string;queries:ResearchQuery[];claimCount:number;expiresAt:string;nextModelCallAt:string};
export type RetrievedEvidence=Reference&{provenance:'web_fetched';url:string;title:string;fetchedAt:string;publisherDomain:string;contentDigest:string;excerptStart:number;excerptEnd:number;fullTextLength:number;extractionVersion:string};
export type ResearchAttempt={url?:string;query?:string;stage:'search'|'fetch';status:'completed'|'empty'|'failed'|'disallowed'|'inaccessible';reason?:string};
export type EvidenceBundle={schemaVersion:'evidence-1.0';planId:string;claimId:string;token:string;references:RetrievedEvidence[];attempts:ResearchAttempt[];expiresAt:string};
export type SourcePerspective={referenceId:string;positionText:string;stance:'supports_position'|'opposes_position'|'adds_context'|'not_expressed'|'undetermined';quote:string;start:number;end:number;explanation:string};
export type ResearchVerification=Verification&{perspectiveChecks?:SourcePerspective[]};
export type Recommendation={referenceId:string;title:string;url:string;publisherDomain:string;kind:'different_evidence'|'opposing_view'|'supporting_view'|'context';reason:string;quote:string;start:number;end:number;provenance:'web_fetched'};
export type ReliabilityReview={status:'not_started'|'investigating'|'no_factual_claims'|'partially_reviewed'|'supported_in_reviewed_scope'|'contradiction_found'|'needs_more_evidence'|'research_unavailable';label:string;totalClaims:number;completedClaims:number;supported:number;contradicted:number;conflicting:number;insufficient:number;remaining:number;sourceCount:number;publisherDomainCount:number;scopeNote:string;checks:Check[]};
