import type {Analysis} from './contracts';
import type {AnalysisPreview} from './analysis-preview';

export async function requestAnalysis(input:unknown,signal:AbortSignal,onPreview:(value:AnalysisPreview)=>void):Promise<Analysis>{
  const response=await fetch('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json','Accept':'text/event-stream'},body:JSON.stringify(input),signal});
  if(!response.headers.get('content-type')?.includes('text/event-stream')){
    const value=await response.json() as Analysis&{error?:{message?:string;code?:string}};
    if(!response.ok)throw Object.assign(new Error(value.error?.message??'분석 요청에 실패했습니다.'),{code:value.error?.code});
    return value as Analysis;
  }
  const reader=response.body?.getReader();
  if(!reader)throw new Error('분석 응답을 읽지 못했습니다.');
  const decoder=new TextDecoder();let buffer='',result:Analysis|undefined;
  try{
    while(true){
      signal.throwIfAborted();
      const chunk=await reader.read();if(chunk.done)break;
      buffer+=decoder.decode(chunk.value,{stream:true});
      let end;
      while((end=buffer.indexOf('\n\n'))>=0){
        const frame=buffer.slice(0,end);buffer=buffer.slice(end+2);
        const event=frame.split('\n').find(line=>line.startsWith('event:'))?.slice(6).trim();
        const data=frame.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trim()).join('\n');
        if(!data)continue;
        const value=JSON.parse(data);
        if(event==='preview')onPreview(value as AnalysisPreview);
        if(event==='error')throw Object.assign(new Error(value.error?.message??'분석에 실패했습니다.'),{code:value.error?.code});
        if(event==='result')result=value as Analysis;
      }
      if(result)return result;
    }
    throw new Error('분석 결과를 모두 받지 못했습니다.');
  }finally{await reader.cancel().catch(()=>{});}
}
