import {describe,it,expect} from 'vitest';
import {localVoiceResearchPlugin} from '../scripts/vite/local-voice-research-plugin.mjs';
import localResearchVoice from '../lib/server/local-research-voice';
import localResearchComparison from '../lib/server/local-research-comparison';

describe('local research voice isolation',()=>{
 it('keeps the normal source model null and plugin disabled without explicit opt-in',()=>{
  expect(localResearchVoice).toBeNull();
  expect(localResearchComparison).toBeNull();
  expect(localVoiceResearchPlugin({command:'build',root:process.cwd(),env:{NODE_ENV:process.env.NODE_ENV??'test'}})).toBeNull();
 });
 it('rejects injecting a research candidate in the canonical production build',()=>{
  expect(()=>localVoiceResearchPlugin({command:'build',root:process.cwd(),env:{NODE_ENV:process.env.NODE_ENV??'test',LOCAL_VOICE_RESEARCH_MODEL:'irrelevant',LOCAL_VOICE_RESEARCH_CANONICAL_ROOT:process.cwd()}})).toThrow('isolated checkout');
 });
 it('rejects a candidate outside the project runtime before parsing it',()=>{
  expect(()=>localVoiceResearchPlugin({command:'serve',root:process.cwd(),env:{NODE_ENV:process.env.NODE_ENV??'test',LOCAL_VOICE_RESEARCH_MODEL:'package.json'}})).toThrow('inside project .sites-runtime');
 });
});
