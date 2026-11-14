import {describe,it,expect} from 'vitest';
import {denseVoiceInputText,inferDenseVoiceHeads,type DenseVoiceHead,type DenseVoiceHeads} from '../lib/voice-dense';

// Mathematical fixtures only; no fabricated article accuracy measurement.
const row=(column:number,weight:number)=>Array.from({length:2048},(_,index)=>index===column?weight:0);
const binary=(classes:string[],column:number,weight=1):DenseVoiceHead=>({classes,coefficients:[row(column,-weight),row(column,weight)],intercepts:[0,0]});
const heads=():DenseVoiceHeads=>({directionality:binary(['neutral','directional'],0),polarity:binary(['oppose','support'],1),
  speaker:binary(['journalist','source'],2),issue:binary(['none','expansion'],3)});
const vector=(values:number[])=>Array.from({length:2048},(_,i)=>values[i]??0);

describe('dense voice hierarchy arithmetic, never release approval',()=>{
  it('normalizes once and composes directional and polarity heads',()=>{
    const result=inferDenseVoiceHeads(heads(),vector([1,1,1,1]));
    expect(result).toMatchObject({direction:'support',speaker:'source',issue:'expansion'});
    expect(result!.margins.directionality.directional).toBeCloseTo(.5,12);
    expect(inferDenseVoiceHeads(heads(),vector([10,10,10,10]))).toEqual(result);
  });
  it('neutral gate ignores uncertain polarity while an uncertain gate stays unresolved',()=>{
    expect(inferDenseVoiceHeads(heads(),vector([-1,0,1,1]))).toMatchObject({direction:'neutral',polarity:null});
    expect(inferDenseVoiceHeads(heads(),vector([.01,1,1,1]))?.direction).toBeNull();
    expect(inferDenseVoiceHeads(heads(),vector([1,.01,1,1]))?.direction).toBeNull();
  });
  it('uses the same .15 gap on binary serialized positive and negative rows',()=>{
    const model=heads();model.directionality=binary(['neutral','directional'],0,.1);
    expect(inferDenseVoiceHeads(model,vector([1,0,0,0]))?.directionality).toBe('directional');
    model.directionality=binary(['neutral','directional'],0,.07);
    expect(inferDenseVoiceHeads(model,vector([1,0,0,0]))?.directionality).toBeNull();
  });
  it('rejects zero, nonfinite and wrong-dimensional vectors rather than using intercepts',()=>{
    expect(inferDenseVoiceHeads(heads(),vector([]))).toBeNull();
    expect(inferDenseVoiceHeads(heads(),vector([NaN]))).toBeNull();
    expect(inferDenseVoiceHeads(heads(),vector([Infinity]))).toBeNull();
    expect(inferDenseVoiceHeads(heads(),[1])).toBeNull();
  });
  it('rejects malformed classes, coefficient widths and nonfinite coefficients',()=>{
    const classes=heads();classes.polarity.classes=['support','support'];
    expect(inferDenseVoiceHeads(classes,vector([1,1,1,1]))).toBeNull();
    const width=heads();width.issue.coefficients[0]=[1];
    expect(inferDenseVoiceHeads(width,vector([1,1,1,1]))).toBeNull();
    const invalid=heads();invalid.speaker.coefficients[0][0]=Infinity;
    expect(inferDenseVoiceHeads(invalid,vector([1,1,1,1]))).toBeNull();
    const zero=heads();zero.directionality.coefficients=[row(0,0),row(0,0)];
    expect(inferDenseVoiceHeads(zero,vector([1,1,1,1]))).toBeNull();
  });
  it('normalizes extreme finite values without squared-norm overflow',()=>{
    const result=inferDenseVoiceHeads(heads(),vector([1e308,1e308,1e308,1e308]));
    expect(result).toMatchObject({direction:'support',speaker:'source',issue:'expansion'});
    expect(result!.margins.directionality.directional).toBeCloseTo(.5,12);
  });
  it('keeps semantic digits and aliases while removing only the four publisher names',()=>{
    expect(denseVoiceInputText(' 데일리안  원자력 발전소 2030년 12.5%\n핵발전소 ')).toBe('원자력 발전소 2030년 12.5% 핵발전소');
    expect(denseVoiceInputText('WWW.PRESSIAN.COM\tpolicy 123')).toBe('policy 123');
  });
});
