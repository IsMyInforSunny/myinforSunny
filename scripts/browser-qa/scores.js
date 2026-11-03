async page => {
  const check=(ok,message)=>{if(!ok)throw Error(message);};
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const results=[];
  for(const example of ['mixed','neutral','provocative','unsupported','no_comments','conflict','supported']){
    await page.goto(`http://127.0.0.1:5173/?example=${example}`);
    await page.getByRole('status').filter({hasText:'가상 예시'}).waitFor();
    const axes={
      bias:await page.locator('.cv3-axis-bias .cv3-axis-value').innerText(),
      stimulation:await page.locator('.cv3-axis-expression .cv3-axis-value').innerText(),
      reliability:await page.locator('.cv3-axis-trust .cv3-axis-value').innerText(),
    };
    for(const width of [375,1280]){
      await page.setViewportSize({width,height:850});
      check(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),`${example}: overflow at ${width}`);
    }
    await page.getByRole('button',{name:'분석근거 표시',exact:true}).click();
    await page.getByText('잘못된 부분이 있나요? 검토 기록 내보내기',{exact:true}).click();
    const exported=JSON.parse(await page.locator('.export-preview pre').textContent());
    check(exported.schemaVersion==='2.4'&&exported.parentAnalysisId&&exported.inputState==='current'&&!exported.stale,`${example}: export identity`);
    check(!exported.citedSources&&!exported.analysis,`${example}: default raw data disclosure`);
    for(const [axis,score] of Object.entries(exported.scores).filter(([key])=>key!=='version')){
      const expected=score.value===null?score.status==='not_applicable'?'해당 없음':'산출 대기'
        :score.status==='partial'&&score.upperBound!==undefined&&score.upperBound!==score.value?`${score.value}–${score.upperBound}점`:`${score.value}점`;
      check(axes[axis].includes(expected),`${example}: ${axis} screen/export mismatch`);
      if(axis!=='bias'&&score.denominator>0)check(axes[axis].includes(`n=${score.denominator}`),`${example}: ${axis} denominator missing`);
    }
    check(exported.scores.bias.value===null&&exported.scores.bias.status==='pending',`${example}: demo fabricated bias`);
    await page.getByLabel('입력 원문과 상세 분석 포함',{exact:true}).check();
    const raw=JSON.parse(await page.locator('.export-preview pre').textContent());
    check(!!raw.citedSources&&!!raw.analysis,`${example}: opted-in raw data absent`);
    results.push({example,axes,scoreExportMatches:true});
  }
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'기사 다시 입력',exact:true}).click();
  const body=page.getByRole('textbox',{name:'본문 필수',exact:true});
  await body.fill((await body.inputValue())+' 새로 추가한 가상 문장입니다.');
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'분석근거 표시',exact:true}).click();
  // Details stay open within this same analysis; changing input must label its export stale.
  const previous=JSON.parse(await page.locator('.export-preview pre').textContent());
  check(previous.stale&&previous.inputState==='stale'&&previous.note.includes('이전 입력'), 'Changed input exported as current');
  for(const route of ['/methodology','/popup?example=unsupported']){
    await page.goto(`http://127.0.0.1:5173${route}`);await page.locator('main').waitFor();
    for(const width of [375,560]){
      await page.setViewportSize({width,height:850});
      check(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),`${route}: overflow at ${width}`);
    }
  }
  check(errors.length===0,JSON.stringify(errors));
  return {scope:'local demos and current/stale exports; no external APIs or real bias model',results,staleExportLabeled:true,pageErrors:errors};
}
