import * as v from 'valibot';
import {ShardfileHashSchema, ShardSlugSchema} from '@wildshard/format/uploadWire';

/** Parent-to-local-game identity; API acknowledgement uses these same bytes. */
export interface UploadActivation {readonly uploadId: string; readonly hash: string; readonly slug: string; readonly channel: 'staging' | 'production'; readonly place?: boolean | undefined}
export interface UploadActivationAck extends UploadActivation {readonly build: string; readonly preloaded: true; readonly instances: readonly string[]}
const fields = {uploadId: v.pipe(v.string(), v.regex(/^[a-f0-9-]{36}$/u)), hash: ShardfileHashSchema, slug: ShardSlugSchema, channel: v.picklist(['staging', 'production']), place: v.optional(v.boolean())};
export const UploadActivationSchema: v.GenericSchema<UploadActivation> = v.strictObject(fields);
export const UploadActivationAckSchema: v.GenericSchema<UploadActivationAck> = v.strictObject({...fields, build: v.string(), preloaded: v.literal(true), instances: v.array(v.string())});
