import { Color, MeshStandardMaterial } from 'three';
import { expect, test } from 'vitest';
import { ChannelMaterial, channelLookOf } from '../src/client/engine/entities/channelLook';

// ONE-FORMAT CC28b: a body's material follows its actor channels on every page.
const body = {
  channels: [{ name: 'jaw' }, { name: 'fade', initial: 1 }, { name: 'glow' }],
  bind: { tint: { channel: 'jaw', colour: [1, 0, 0] as [number, number, number] }, emissive: { channel: 'glow', colour: [0, 0, 1] as [number, number, number] }, opacity: 'fade' },
};

test('a body binds each material term to its channel by the wire order', () => {
  expect(channelLookOf(body)).toEqual({ tint: { index: 0, colour: [1, 0, 0] }, emissive: { index: 2, colour: [0, 0, 1] }, opacity: 1 });
  expect(channelLookOf({ channels: [{ name: 'jaw' }] })).toBeUndefined();
  expect(() => channelLookOf({ channels: [], bind: { opacity: 'fade' } })).toThrow('Undeclared creature channel fade');
});

test('opacity 0.1 draws at 0.1, and a full channel draws opaque again', () => {
  const look = channelLookOf(body); if (look === undefined) throw new Error('Missing channel look');
  const material = new MeshStandardMaterial({ color: new Color(0, 1, 0) }), rest = new Color();
  const channels = new ChannelMaterial(look, material);
  channels.apply([0, 0.1, 0, 0], rest);
  expect(material.opacity).toBeCloseTo(0.1, 6); expect(material.transparent).toBe(true);
  channels.apply([0, 1, 0, 0], rest);
  expect(material.opacity).toBe(1); expect(material.transparent).toBe(false);
});

test('tint pulls the colour toward its colour and emissive adds a glow to the resting one', () => {
  const look = channelLookOf(body); if (look === undefined) throw new Error('Missing channel look');
  const material = new MeshStandardMaterial({ color: new Color(0, 1, 0), emissive: new Color(0.1, 0, 0) }), rest = new Color();
  const channels = new ChannelMaterial(look, material);
  channels.apply([0.5, 1, 0.5, 0], rest);
  expect(material.color.toArray()).toEqual([0.5, 0.5, 0]);
  expect(rest.toArray()).toEqual([0.1, 0, 0.5]);
  channels.apply([0, 1, 0, 0], rest);
  expect(material.color.toArray()).toEqual([0, 1, 0]); expect(rest.toArray()).toEqual([0.1, 0, 0]);
});
