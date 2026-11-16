import {encodeCanonicalJson,hashImmutableBytes} from '../../../shared/host/immutable';
import type {WorldWord} from '@wildshard/engine/net/socketFrames';
import type {PlayerDoc} from './playerDoc';

/** A current database document that this exact admission successfully imported, never an optimistic save acknowledgement. */
export interface DurableCheckpoint {
 readonly seq:number;readonly shard:string;readonly ledgerSerial:number;readonly progressHash:string;
 readonly at:{readonly x:number;readonly y:number;readonly z:number};
}

/** Internal provenance stays on the door/worker port, never on a game socket. */
export interface CheckpointCertificate {readonly docHash:string;readonly witness:DurableCheckpoint}
const digest=(value:unknown):string=>hashImmutableBytes(new TextEncoder().encode(encodeCanonicalJson(value)));

/** Only the database reader supplies this after reading a current durable document. No timestamp is invented. */
export function checkpointCertificate(doc:PlayerDoc,seq:number,shard:string):CheckpointCertificate|undefined{
 if(!Number.isSafeInteger(seq)||seq<1||!Number.isSafeInteger(doc.ledger.serial)||doc.ledger.serial<0||
  !/^_?[a-z0-9][a-z0-9-]{0,94}$/u.test(shard))return undefined;
 // Position, health clocks and host seat identity are not persistent progress comparisons.
 const {player:_player,...book}=doc.book;
 const witness:DurableCheckpoint={seq,shard,ledgerSerial:doc.ledger.serial,
  progressHash:digest({book,store:doc.store,ledger:doc.ledger}),at:{x:doc.at.x,y:doc.at.y,z:doc.at.z}};
 return {docHash:digest(doc),witness};
}

/** Import recovery/fallback cannot reuse the current document's certificate. */
export function importedCheckpoint(certificate:CheckpointCertificate|undefined,doc:PlayerDoc|null):DurableCheckpoint|undefined{
 return certificate!==undefined&&doc!==null&&certificate.docHash===digest(doc)?certificate.witness:undefined;
}

/** Existing world9 discovery envelope, optional bounded status, no repeated device request. */
export function checkpointWord(discovery:Pick<WorldWord,'cells'|'shards'>,checkpoint:DurableCheckpoint):ArrayBuffer|undefined{
 const status={v:1 as const,checkpoint};
 if(new TextEncoder().encode(JSON.stringify(status)).byteLength>512)return undefined;
 return new TextEncoder().encode(JSON.stringify({...discovery,status} satisfies WorldWord)).buffer;
}
