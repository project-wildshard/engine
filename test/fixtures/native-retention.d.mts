/** Request only the queue's bounded failed-hook export; never copy, delete or grant a verdict. */
export function requestNativeRetention(kind: 'native-writer-drain' | 'native-escape', profile: string): string;
