import { expect, it } from 'vitest';
import type { GraphIr } from '@wildshard/format/materialGraph';
import { compileClassicGraph } from './glslMaterial';
import { levelFrameSource } from '../../world/backdropLayer';

const CARD: GraphIr = { version: 1, kind: 'material', model: 'unlit', doubleSided: true,
  nodes: { vertex: { op: 'positionGeometry' }, xy: { op: 'swizzle', in: ['vertex'], mask: 'xy' }, local: { op: 'mul', in: ['xy', 40] },
    card: { op: 'cameraRelativeBillboard', in: [[0.3, 0.2, -0.93], 820, 'local'] } },
  stages: { 'vertex.position': { position: 'card' }, surface: { colour: [1, 0.8, 0.5] } },
  effectState: { blend: 'additive', depthWrite: false, fog: false } };

it('draws a classic graph dressing in a layer frame through the GLSL defines', () => {
  const material = compileClassicGraph(CARD).material;
  try {
    const page = { vertex: material.vertexShader, fragment: material.fragmentShader };
    const layered = { vertex: levelFrameSource(page.vertex, 'vertex'), fragment: levelFrameSource(page.fragment, 'fragment') };
    // the camera less the origin and the frame's view, defined ahead of the graph's own camera reads
    for (const stage of [layered.vertex, layered.fragment]) {
      expect(stage).toMatch(/#define viewMatrix wsLayerView/u);
      expect(stage).toMatch(/#define cameraPosition \(cameraPosition - wsLayerOrigin\)/u);
      expect(stage.indexOf('#define cameraPosition')).toBeLessThan(stage.indexOf('#define wsFrameCamera cameraPosition'));
    }
    expect(layered.vertex).toMatch(/#define modelViewMatrix \(wsLayerView \* modelMatrix\)/u);
    // the billboard reads the frame camera, which the define moves
    expect(page.vertex).toMatch(/wsFrameCamera \+ /u);
    // one more fragment uniform (the fade) scales the graph's alpha after its own main
    expect(layered.fragment).toContain('uniform float wsLayerFade;');
    expect(layered.fragment).toContain('void main() { wsLayerMain(); gl_FragColor.a *= wsLayerFade; }');
    expect(levelFrameSource(page.fragment, 'fragment', true)).toContain('gl_FragColor *= wsLayerFade;');
    expect(page.vertex).not.toContain('wsLayerView');
  } finally { material.dispose(); }
});
