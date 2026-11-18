export function ownSimulatorHid(udid: string): {
  tapOrSwipe: (args: string[]) => Promise<void>;
  close: () => Promise<void>;
};
