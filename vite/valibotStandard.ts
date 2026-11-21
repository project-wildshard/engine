/**
 * DF11 (meta DRIFTWOOD-FPS, mini-df11g): valibot 1.5 eagerly attaches Standard Schema props to every schema it makes
 * (`_standardSchema`: an object, a `validate` closure and its scope, three heap cells per schema). The client holds ~18k
 * schemas, mostly the shard format's, and nothing in the bundle reads `~standard`; WebKit's full collection pays per live
 * cell. This transform gives every schema a shared prototype whose lazy, non-enumerable `~standard` accessor builds the
 * same object on first read (and then stores it as the schema's own data property), so every schema keeps its behaviour
 * and drops all three cells. Inherited and non-enumerable, it is never copied by object spreads (`v.pipe` copies its
 * first schema) and never materialised by them. A valibot upgrade that
 * changes `_standardSchema` fails the build here rather than silently keeping the eager glue.
 */
import type { Plugin } from 'vite';

/** valibot 1.5.0's `_standardSchema`, byte for byte (dist/index.mjs). */
export const EAGER_STANDARD = `function _standardSchema(schema) {
	schema["~standard"] = {
		version: 1,
		vendor: "valibot",
		validate: (value$1) => schema["~run"]({ value: value$1 }, /* @__PURE__ */ getGlobalConfig())
	};
	return schema;
}`;

/** The lazy replacement: every schema inherits one accessor from a shared prototype (no per-schema accessor cell); the
 * first read, or a write, defines the props as the schema's own data property. */
export const LAZY_STANDARD = `const _standardSchemaPrototype = Object.create(Object.prototype, { "~standard": {
	get() {
		const schema = this;
		const props = {
			version: 1,
			vendor: "valibot",
			validate: (value$1) => schema["~run"]({ value: value$1 }, /* @__PURE__ */ getGlobalConfig())
		};
		Object.defineProperty(schema, "~standard", { value: props, writable: true, configurable: true, enumerable: false });
		return props;
	},
	set(value) {
		Object.defineProperty(this, "~standard", { value, writable: true, configurable: true, enumerable: false });
	},
	configurable: true,
	enumerable: false
} });
function _standardSchema(schema) {
	Object.setPrototypeOf(schema, _standardSchemaPrototype);
	return schema;
}`;

/** Rewrite valibot's dist once; refuse a valibot whose `_standardSchema` differs. */
export function lazyValibotStandard(code: string, id: string): string | null {
  if (!/[\\/]valibot[\\/]dist[\\/]index\.mjs$/u.test(id)) return null;
  const at = code.indexOf(EAGER_STANDARD);
  if (at === -1 || code.includes(EAGER_STANDARD, at + 1)) throw new Error(`valibot's _standardSchema changed (${id}); update vite/valibotStandard.ts`);
  return code.slice(0, at) + LAZY_STANDARD + code.slice(at + EAGER_STANDARD.length);
}

/** The client build's plugin. */
export function valibotStandardPlugin(): Plugin {
  return { name: 'wildshard:valibot-lazy-standard', enforce: 'pre', transform(code, id) { const out = lazyValibotStandard(code, id); return out === null ? null : { code: out, map: null }; } };
}
