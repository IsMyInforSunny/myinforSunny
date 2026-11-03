async page => {
  const check=(ok,message)=>{if(!ok)throw Error(message);};
  const loaded=page.waitForResponse(r=>r.url().endsWith('/api/capabilities'));
  await page.goto('http://127.0.0.1:5173/?example=supported');await loaded;
  await page.getByRole('status').filter({hasText:'가상 예시'}).waitFor();
  await page.getByRole('img',{name:/편향 정도 계산 대기/}).waitFor();
  await page.getByRole('button',{name:'분석근거 표시',exact:true}).click();
  await page.getByText('잘못된 부분이 있나요? 검토 기록 내보내기',{exact:true}).click();
  const download=async name=>{
    const expected=JSON.parse(await page.locator('.export-preview pre').textContent());
    const started=page.waitForEvent('download');
    await page.getByRole('button',{name:'JSON 파일로 저장',exact:true}).click();
    const file=await started;
    check(await file.failure()===null,'Browser download failed');
    check(file.suggestedFilename().endsWith('.json'),'Download filename is not JSON');
    await file.saveAs(`output/playwright/${name}.json`);
    const stream=await file.createReadStream();let content='';
    for await(const chunk of stream)content+=chunk.toString('utf8');
    const value=JSON.parse(content);
    check(JSON.stringify(value)===JSON.stringify(expected),'Downloaded content differs from the preview');
    return value;
  };
  const minimal=await download('review-default-1815');
  check(minimal.summary.completedChecks===1,'Default download lost the current completed check');
  check(!('analysis' in minimal)&&!('verifications' in minimal)&&!('results' in minimal.research),'Default download includes source details without opt-in');
  await page.getByRole('checkbox',{name:'입력 원문과 상세 분석 포함'}).check();
  await page.getByRole('checkbox',{name:'대조 자료와 인용 포함'}).check();
  const detailed=await download('review-opt-in-1815');
  check(detailed.analysis.mode==='demo'&&detailed.analysis.sources.length>0,'Opt-in download omits the synthetic input');
  check(detailed.verifications.length===1&&detailed.verifications[0].references.length===1,'Opt-in download omits the synthetic reference');
  check(detailed.verifications[0].checks[0].relations.length===1,'Opt-in download omits the quoted relation');
  await page.keyboard.press('Escape');
  return {scope:'actual local JSON downloads using the public synthetic supported example',passed:[
    'default and opt-in files download successfully as JSON',
    'downloaded data equals the visible export preview',
    'default file excludes input and reference details',
    'opt-in file includes the current synthetic input, reference and quoted relation',
  ]};
}
