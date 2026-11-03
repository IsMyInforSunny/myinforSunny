async page => {
  const check=(value,message)=>{if(!value)throw Error(message);};
  const origin='http://127.0.0.1:5173';
  const cap=await (await page.request.get(origin+'/api/capabilities')).json();
  let requests=0,payload;
  const capabilities=route=>route.fulfill({json:{...cap,live:true,webSearch:false,webFetch:false}});
  const analyze=route=>{const request=route.request().postDataJSON();if(request.kind==='demo')return route.continue();requests++;payload=request;return route.fulfill({status:422,json:{error:{code:'VALIDATION_ERROR',message:'입력 내용을 확인해 주세요.',fields:[{path:'body',message:'본문을 확인해 주세요.'},{path:'unexpected_private_key',message:'must not be displayed'}]}}});};
  await page.route('**/api/capabilities',capabilities);
  await page.route('**/api/analyze',analyze);
  try {
    await page.goto(origin+'/?qa=consent-'+Date.now()+'#selection='+encodeURIComponent('공개 가상 본문입니다.'));
    const body=page.getByRole('textbox',{name:'본문 필수'});
    await body.waitFor();
    check(await body.inputValue()==='공개 가상 본문입니다.','Selection bootstrap lost text');
    check(!new URL(page.url()).hash,'Selection fragment was retained');
    const consent=page.locator('dialog[open] .transmission-consent input');
    await consent.check();
    await body.fill('수정된 공개 가상 본문입니다.');
    check(!await consent.isChecked(),'Body edit retained consent');
    await body.fill('공개 가상 본문입니다.');
    check(!await consent.isChecked(),'Undo restored consent');
    await consent.check();
    await page.getByRole('button',{name:'댓글 추가하기',exact:true}).click();
    check(!await consent.isChecked(),'Adding a comment retained consent');
    await consent.check();
    await page.getByRole('textbox',{name:'댓글 1',exact:true}).fill('공개 가상 댓글입니다.');
    check(!await consent.isChecked(),'Comment edit retained consent');
    await page.locator('summary').filter({hasText:'찬반 입장도 살펴보고 싶다면'}).click();
    await consent.check();
    await page.getByRole('textbox',{name:'찬반을 살펴볼 명제',exact:true}).fill('학교 도서관을 확대해야 한다.');
    check(!await consent.isChecked(),'Proposition edit retained consent');
    await page.getByRole('button',{name:'정보 성분표 만들기',exact:true}).click();
    check(requests===0,'Missing consent dispatched a request');
    await consent.check();
    await page.getByRole('button',{name:'정보 성분표 만들기',exact:true}).click();
    await page.locator('dialog[open] [role=status]').filter({hasText:'body: 본문을 확인해 주세요.'}).waitFor();
    check(requests===1&&payload.kind==='text'&&payload.transmissionConsent===true&&payload.comments.length===1,'Wrong request contract');
    check(!(await page.locator('main').innerText()).includes('must not be displayed'),'Unexpected field path exposed');
    await page.goto(origin+'/?example=supported');
    await page.getByRole('button',{name:'분석근거 표시',exact:true}).click();
    await page.getByRole('tab',{name:'주장 · 자료 대조 1'}).click();
    const referenceConsent=page.locator('dialog[open] .transmission-consent input');
    await referenceConsent.check();
    await page.getByRole('textbox',{name:'참고자료 1 본문'}).fill('수정한 공개 가상 참고자료입니다.');
    check(!await referenceConsent.isChecked(),'Reference edit retained consent');
    return {scope:'local browser with intercepted analysis; external inference requests: 0',passed:['selection bootstrap and fragment removal','body edit and undo revoke consent','comment addition and edit revoke consent','proposition edit revokes consent','unconsented dispatch blocked','text request contract and safe 422 field message','reference edit revokes consent']};
  } finally {
    await page.unroute('**/api/capabilities',capabilities);
    await page.unroute('**/api/analyze',analyze);
  }
}
