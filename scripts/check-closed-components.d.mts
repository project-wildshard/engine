import type { Component, ComponentInventory } from './shard-components.mjs';

export type ClosedComponents = Record<string, Component[]>;
export function closedComponents(input?: unknown): ClosedComponents;
export function compareClosedComponents(before: unknown, after: unknown): string[];
export function closedComponentFailures(rows: Record<string, {components?: ComponentInventory}>, input: unknown): string[];
export function closedComponentSources(root: string, input: unknown): string[];
