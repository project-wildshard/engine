import {expect,test} from 'vitest';
import * as inputs from '../scripts/push-dependencies.mjs';

test('installed reads reject growth before allocating and cap empty-file reads',()=>{
 const before={dev:1n,ino:2n,size:0n};let allocated=0,read=0;
 const io={stat:()=>({...before,size:1024n,isFile:()=>true}),allocate:n=>{allocated+=n;return Buffer.alloc(n);},read:()=>{read++;return 1;}};
 expect(()=>inputs.readInstalledBytes(7,before,io)).toThrow();expect(allocated).toBe(0);expect(read).toBe(0);
 io.stat=()=>({...before,isFile:()=>true});
 expect(()=>inputs.readInstalledBytes(7,before,io)).toThrow();expect(allocated).toBeLessThanOrEqual(1);expect(read).toBe(1);
});
test('bounded installed reads never consume more than the measured body and one probe',()=>{
 const before={dev:1n,ino:2n,size:3n},lengths=[];let at=0;
 const io={stat:()=>({...before,isFile:()=>true}),allocate:n=>Buffer.alloc(n),read:(_fd,body,offset,length)=>{lengths.push(length);if(at===3)return 0;body[offset]=97+at++;return 1;}};
 expect(inputs.readInstalledBytes(7,before,io).toString()).toBe('abc');expect(lengths).toEqual([3,2,1,1]);
});
