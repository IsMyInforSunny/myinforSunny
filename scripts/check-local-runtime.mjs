import assert from 'node:assert/strict';

// Only contact this machine; this check must not run against the public Site.
const origin = new URL(process.argv[2] ?? 'http://127.0.0.1:5173');
assert.equal(origin.protocol, 'http:');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname), 'Use a loopback address.');
const results = [];
async function request(path, init) {
  const response = await fetch(new URL(path, origin), {
    ...init, redirect: 'error', signal: AbortSignal.timeout(90_000),
  });
  return response;
}
for (const route of ['/', '/analyze', '/popup', '/methodology']) {
  const response = await request(route);
  assert.equal(response.status, 200, route);
  assert.match(await response.text(), /<html[\s>]/i, route);
  results.push({route, status: 200});
}
const health = await request('/api/health');
assert.equal(health.status, 200);
assert.equal((await health.json()).status, 'ok');
const privateConfig = await request('/.dev.vars');
assert.equal(privateConfig.status, 403, 'Worker local configuration must not be served.');
const capabilityResponse = await request('/api/capabilities');
assert.equal(capabilityResponse.status, 200);
const capabilities = await capabilityResponse.json();
assert.equal(capabilities.live, false, 'Local live analysis must stay disabled.');
assert.equal(capabilities.webSearch, false, 'Local external search must stay disabled.');
assert.equal(capabilities.webFetch, false, 'Local external article fetch must stay disabled.');
const post = body => request('/api/analyze', {
  method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body),
});
const demoResponse = await post({kind: 'demo', fixtureId: 'supported'});
assert.equal(demoResponse.status, 200);
const demo = await demoResponse.json();
assert.equal(demo.mode, 'demo');
assert.ok(demo.sources.length > 0);
const liveResponse = await post({
  kind: 'text', body: 'The fictional school garden opens at nine.',
  comments: [], transmissionConsent: true,
});
assert.equal(liveResponse.status, 503, 'Disabled live requests must fail before inference.');
console.log(JSON.stringify({
  check: 'local HTTP routes, demo analysis and disabled external features',
  status: 'passed', origin: origin.origin, pages: results,
  live: capabilities.live, webSearch: capabilities.webSearch, webFetch: capabilities.webFetch,
  demoMode: demo.mode, disabledLiveRequestStatus: liveResponse.status,
  privateConfigRequestStatus: privateConfig.status,
}, null, 2));
