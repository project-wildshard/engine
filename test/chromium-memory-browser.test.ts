import {expect,it} from 'vitest';
import {memoryNetworkCommand} from '../scripts/chromium-memory-browser.mjs';

it('caps every Inspector session without mutating events or cache controls',()=>{
  const original={id:7,sessionId:'playwright-page',method:'Network.enable',params:{maxTotalBufferSize:200000000,reportDirectSocketTraffic:true}};
  expect(memoryNetworkCommand(original)).toEqual({...original,params:{maxTotalBufferSize:0,maxResourceBufferSize:0,maxPostDataSize:0,reportDirectSocketTraffic:true}});
  expect(original.params.maxTotalBufferSize).toBe(200000000);
  expect(memoryNetworkCommand({id:8,sessionId:'worker',method:'Network.enable'})).toEqual({id:8,sessionId:'worker',method:'Network.enable',params:{maxTotalBufferSize:0,maxResourceBufferSize:0,maxPostDataSize:0}});
  for(const method of ['Network.setCacheDisabled','Network.responseReceived','Network.getResponseBody','Runtime.evaluate']){
    const command={method,params:{cacheDisabled:false}};
    expect(memoryNetworkCommand(command)).toBe(command);
  }
  expect(()=>memoryNetworkCommand({method:'Network.enable',params:42})).toThrow();
});
