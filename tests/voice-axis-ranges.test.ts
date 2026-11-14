import {describe,expect,it} from 'vitest';
import {VOICE_ARTICLE_ISSUE,VOICE_INDEPENDENT_NEUTRAL,VOICE_VERSION,voiceAnnotationInput,summarizeVoices,validateVoiceDocument,type VoiceDocument,type VoiceLabel} from '../lib/sentence-voice';
import {mainVoiceIssue,compareVoiceCoordinates,voiceCoordinateBounds,type VoiceCoordinate} from '../lib/voice-comparison';

function documentFor(labels:Omit<VoiceLabel,'sentenceId'>[],fixed=true){
  const body=labels.map((_,index)=>`Article statement ${index+1}.`).join(' ');
  const input=voiceAnnotationInput(body,'nuclear_energy');
  const document:VoiceDocument={...input,method:'svm',modelVersion:'test-axis',decisionPolicy:VOICE_INDEPENDENT_NEUTRAL,
    ...(fixed?{articleIssue:'expansion',issuePolicy:VOICE_ARTICLE_ISSUE}:{}),
    labels:input.sentences.map((unit,index)=>({...labels[index],sentenceId:unit.sentenceId}))};
  return {body,document};
}
const source=(direction:VoiceLabel['direction']='support',issue='expansion'):Omit<VoiceLabel,'sentenceId'>=>({direction,issue,speaker:'source'});
const item=(id:string,publisher:string,coordinate:number|null,bounds?:{lower:number;upper:number}):VoiceCoordinate=>({id,url:`https://${publisher}/${id}`,publisher,bodyHash:id,eventId:'same-event',
  topic:'nuclear_energy',issue:'expansion',method:'svm',modelVersion:'test-axis',version:VOICE_VERSION,coordinate,directional:3,unresolved:bounds&&bounds.lower!==bounds.upper?1:0,
  trainingOriginal:false,axis:'source',issuePolicy:VOICE_ARTICLE_ISSUE,decisionPolicy:VOICE_INDEPENDENT_NEUTRAL,...(bounds?{bounds}:{})});
const population=()=>Array.from({length:6},(_,i)=>item(`ref-${i}`,i<3?'a.test':'b.test',i<3?-1:0));

describe('separate article voice axes and range eligibility',()=>{
  it('uses source quotations for the primary coordinate and reports journalist direction independently',()=>{
    const {body,document}=documentFor([...Array.from({length:4},()=>source('oppose')),...Array.from({length:3},()=>({...source(),speaker:'journalist' as const}))]);
    const summary=summarizeVoices(body,document)!.issues.find(issue=>issue.issue==='expansion')!;
    expect(summary.source).toMatchObject({support:0,oppose:4,coordinate:-1,evidence:{lower:-1,upper:-1}});
    expect(summary.journalist).toMatchObject({support:3,oppose:0,coordinate:1});
    expect(mainVoiceIssue(body,document)).toMatchObject({coordinate:-1,directional:4,axis:'source',journalist:{coordinate:1}});
  });
  it('keeps the article-level issue even when another issue has more classified sentences',()=>{
    const {body,document}=documentFor([...Array.from({length:3},()=>source()),...Array.from({length:5},()=>source('oppose','lifetime'))]);
    expect(mainVoiceIssue(body,document)?.issue).toBe('expansion');
    expect(mainVoiceIssue(body,document)?.coordinate).toBe(1);
    expect(validateVoiceDocument(body,{...document,articleIssue:'invented'})).toBeNull();
    expect(validateVoiceDocument(body,{...document,issuePolicy:undefined})).toBeNull();
  });
  it('includes unknown speakers conservatively in both axis ranges',()=>{
    const {body,document}=documentFor([...Array.from({length:3},()=>source()),{issue:'expansion',direction:'uncertain',speaker:'unknown'}]);
    const primary=mainVoiceIssue(body,document)!;
    expect(primary.source.evidence).toMatchObject({lower:.5,upper:1,unresolved:1});
    expect(primary.journalist.evidence).toMatchObject({lower:-1,upper:1,unresolved:1,directional:0});
    expect(primary).toMatchObject({eligible:true,coordinate:null,bounds:{lower:.5,upper:1}});
  });
  it('does not let journalist uncertainty erase a fully observed quotation balance',()=>{
    const {body,document}=documentFor([...Array.from({length:3},()=>source('oppose')),{issue:'expansion',direction:'uncertain',speaker:'journalist'}]);
    expect(summarizeVoices(body,document)?.unresolved).toBe(1);
    expect(mainVoiceIssue(body,document)).toMatchObject({coordinate:-1,eligible:true,unresolved:0});
  });
  it('keeps excessively wide ranges pending without converting unknowns to neutral',()=>{
    const {body,document}=documentFor([...Array.from({length:3},()=>source()),source('uncertain'),source('uncertain')]);
    const primary=mainVoiceIssue(body,document)!;
    expect(primary.source.evidence).toMatchObject({lower:.2,upper:1,unresolved:2});
    expect(primary).toMatchObject({coordinate:null,bounds:null,eligible:false});
    expect(document.labels.filter(label=>label.direction==='uncertain')).toHaveLength(2);
  });
  it('returns a score range and a direction only when the whole input interval is on one side',()=>{
    const result=compareVoiceCoordinates(item('input','input.test',null,{lower:.5,upper:1}),population());
    expect(result).toMatchObject({status:'ready',baseline:-.5,score:null,magnitude:null,scoreBounds:{lower:50,upper:75},direction:'support'});
    const centered=population().map(row=>({...row,coordinate:row.publisher==='a.test'?-.5:0}));
    expect(compareVoiceCoordinates(item('input','input.test',null,{lower:-.5,upper:0}),centered)).toMatchObject({status:'ready',score:null,scoreBounds:{lower:0,upper:13},direction:'undetermined',opposing:[],similar:[]});
  });
  it('excludes range articles from the distribution while retaining their eligible counts',()=>{
    const articles=[item('a1','a.test',-.8),item('a2','a.test',-.6),item('a3','a.test',null,{lower:-1,upper:-.5}),
      item('b1','b.test',.3),item('b2','b.test',.5),item('b3','b.test',null,{lower:.5,upper:1})];
    const result=compareVoiceCoordinates(item('input','input.test',1),articles);
    expect(result).toMatchObject({status:'ready',count:6,publisherCount:2,rangeCount:2,distributionCount:4});
    expect(result.baseline).toBeCloseTo(-.15);
    expect(result.opposing.every(article=>article.coordinate!==null)).toBe(true);
  });
  it('does not mix axes, issue policies or unresolved legacy scalars',()=>{
    const input=item('input','input.test',1);
    expect(compareVoiceCoordinates(input,population().map(row=>({...row,axis:'journalist'}))).status).toBe('insufficient');
    expect(compareVoiceCoordinates(input,population().map(row=>({...row,issuePolicy:undefined}))).status).toBe('insufficient');
    expect(compareVoiceCoordinates({...input,unresolved:1},population()).status).toBe('input_unresolved');
    for(const bounds of [{lower:-1,upper:1},{lower:1,upper:0},{lower:NaN,upper:1}]){
      expect(voiceCoordinateBounds({...input,coordinate:null,bounds})).toBeNull();
    }
  });
});
