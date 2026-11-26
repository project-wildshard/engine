import type {ObservationSnapshot,PreparedObserver} from '../../test/fixtures/dedicated/releaseObserver';

export function observerCommand(command:string,args:string[],options:{cwd:string;signal:AbortSignal;log:string;storeUse?:string}):Promise<number|null>;
export function prepareObserverClient(snapshot:ObservationSnapshot,signal:AbortSignal,options:{root:string;work:string}):Promise<PreparedObserver>;
