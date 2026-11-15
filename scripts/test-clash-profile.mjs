import assert from 'node:assert/strict';
import {parse} from 'yaml';
import {normalizeClashNodes, createClashProfile, prepareClashResponse} from '../src/core/clash-profile.js';
const input = {proxies: [
 {name:'Airport', type:'anytls', server:'example.com', port:443, password:'test', 'idle-session-timeout':'30s', 'idle-session-check-interval':'500ms','min-idle-session':'0'},
 {name:'AWS-REALITY',type:'vless',server:'192.0.2.1',port:8443,uuid:'00000000-0000-4000-8000-000000000000'},
 {name:'Airport',type:'trojan',server:'example.org',port:443,password:'test'},
]};
const profile=createClashProfile(input);
assert.equal(profile.proxies.length,3);
assert.equal(profile.proxies[0]['idle-session-timeout'],30);
assert.equal(profile.proxies[0]['idle-session-check-interval'],1);
assert.equal(profile.proxies[0]['min-idle-session'],0);
assert.equal(profile.proxies[2].name,'Airport (2)');
assert.equal(input.proxies[0]['idle-session-timeout'],'30s');
assert.deepEqual(profile['proxy-groups'].find(g=>g.name==='AWS').proxies,['AWS-REALITY']);
const known=new Set(['DIRECT',...profile.proxies.map(p=>p.name),...profile['proxy-groups'].map(g=>g.name)]);
for(const group of profile['proxy-groups'])for(const name of group.proxies)assert.ok(known.has(name));
assert.ok(profile.rules.includes('MATCH,PROXY'));
const response={status:200,body:JSON.stringify(input),headers:{'content-length':'1'}};
const request={url:'https://test.example/download/collection/all?target=ClashMeta&profile=clash'};
const output=prepareClashResponse(response,request);
assert.ok(parse(output.body)['proxy-groups']);
assert.equal(output.headers['content-length'],undefined);
assert.equal(output.headers['Cache-Control'],'private, no-store');
assert.equal(prepareClashResponse({...response,status:500},request).status,500);
assert.equal(prepareClashResponse(response,{url:'https://test.example/api/subs'}),response);
assert.throws(()=>normalizeClashNodes([]),/No available/);
console.log('Clash profile compatibility tests passed');
