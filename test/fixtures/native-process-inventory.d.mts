/** Prepare only the native fixture's content-keyed Darwin executable. */
export function warmNativeInventory(): void;
/** The real platform inventory executable and arguments. */
export function nativeInventoryCommand(): {executable: string; args: string[]};
