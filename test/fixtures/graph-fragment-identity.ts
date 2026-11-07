// oxlint-disable-next-line import/no-nodejs-modules -- The offline report joins exact emitted shader sources.
import {createHash} from 'node:crypto';
import type {GraphGlsl} from '../../src/client/engine/render/graph/glsl';
import {graphShaders,graphUniformValues} from '../../src/client/engine/render/graph/glslProgram';
import type {ToonLook} from '../../src/client/engine/render/families/toon';

/** The same wrapper and admitted fog uniforms used by the classic material.
 * Texture values do not enter GLSL source; no replacement texture is supplied.
 * Fog graphs have no draw program, and a selected fog must be resolved. */
export function graphFragmentIdentity(glsl:GraphGlsl,toonLook:ToonLook,selectedFog?:GraphGlsl):{
 readonly main:string|null;readonly outline:string|null;
}{
 if(glsl.ir.kind==='fog')return {main:null,outline:null};
 if(typeof glsl.ir.effectState?.fog==='string'&&selectedFog===undefined)throw new Error('Shader identity requires its admitted fog graph');
 if(selectedFog!==undefined&&selectedFog.ir.kind!=='fog')throw new Error('Shader identity fog dependency is not a fog graph');
 const opts={toonLook,...(selectedFog===undefined?{}:{fog:{glsl:selectedFog,uniforms:graphUniformValues(selectedFog,{toonLook})}})};
 const hash=(outline:boolean):string=>createHash('sha256').update(graphShaders(glsl,{...opts,outline}).fragmentShader).digest('hex');
 return {main:hash(false),outline:glsl.outline===null?null:hash(true)};
}
