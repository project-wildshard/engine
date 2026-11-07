import {expect,it} from 'vitest';
import {Synth} from '../src/client/engine/audio/synth';
import {parseAudioData} from '@wildshard/format/audio';
import {requireAudioProfile} from '@wildshard/engine/audio/audioProfiles';
import audio from './fixtures/nalati-audio-original.json' with {type:'json'};
import replay from './fixtures/nalati-native-phrases.json' with {type:'json'};

/** Native tone/burst and bus recorder: burst consumes its native noise-offset draw. */
class Recorder extends Synth {
 private readonly nodes=new Map<AudioNode,string>();
 private serial=0;
 readonly ctx={currentTime:7.25,createGain:()=>this.node(`bus${this.serial++}`)} as AudioContext;
 readonly sfx=this.node('sfx');
 readonly ambient=this.node('ambient');
 readonly bus=this.node('bus');
 readonly ready=true;
 protected readonly noise={} as AudioBuffer;
 readonly rows:object[]=[];
 draws=0;
 constructor(private state:number){super();}
 private node(id:string):GainNode{const node={gain:{value:1}} as GainNode;this.nodes.set(node,id);return node;}
 private id(node:AudioNode):string{const id=this.nodes.get(node);if(id===undefined)throw new Error('Unowned audio node');return id;}
 random=():number=>{this.draws++;this.state=(Math.imul(this.state,1664525)+1013904223)>>>0;return this.state/4294967296;};
 override tone(opts:Parameters<Synth['tone']>[0]):GainNode{this.rows.push({...opts,out:this.id(opts.out??this.sfx),pan:opts.pan??0,kind:'tone'});return this.sfx;}
 override burst(opts:Parameters<Synth['burst']>[0]):GainNode{this.rows.push({...opts,out:this.id(opts.out??this.sfx),pan:opts.pan??0,kind:'burst',offset:this.random()*1.5});return this.sfx;}
 override route(node:AudioNode,pan:number,out:AudioNode=this.sfx):void{
  if(!('gain' in node)||typeof node.gain!=='object'||node.gain===null||!('value' in node.gain))throw new Error('Missing native bus gain');
  this.rows.push({kind:'route',from:this.id(node),gain:node.gain.value,pan,out:this.id(out)});
 }
}
function close(actual:unknown,expected:unknown):void {
 if(typeof expected==='number'){expect(typeof actual).toBe('number');if(typeof actual==='number')expect(actual).toBeCloseTo(expected,10);return;}
 if(Array.isArray(expected)){expect(Array.isArray(actual)).toBe(true);if(Array.isArray(actual)){expect(actual).toHaveLength(expected.length);for(let i=0;i<expected.length;i++)close(actual[i],expected[i]);}return;}
 if(expected!==null&&typeof expected==='object'){
  if(actual===null||typeof actual!=='object')throw new Error('Missing audio operation');
  expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
  for(const key of Object.keys(expected))close(Reflect.get(actual,key),Reflect.get(expected,key));return;
 }
 expect(actual).toEqual(expected);
}
it('replays native weather, bed, hoof and weapon schedules including pan, branches and noise draws',()=>{
 const phrases=parseAudioData(audio.audio).synth;
 for(const sample of replay.cases){
  const recorder=new Recorder(sample.seed),params:Record<string,number>={};
  for(const [key,value] of Object.entries(sample.params)){if(typeof value!=='number')throw new Error('Invalid replay parameter');params[key]=value;}
  const out=sample.out==='ambient'?recorder.ambient:sample.out==='bus'?recorder.bus:recorder.sfx;
  recorder.playPhrase(requireAudioProfile(phrases?.[sample.program],sample.program),out,params,recorder.random);
  close(recorder.rows,sample.rows);expect(recorder.draws,sample.program).toBe(sample.draws);
 }
});
