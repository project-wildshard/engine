/** Serializable F1 extension values, without callbacks or renderer objects. */
export type SimValue = null | boolean | number | string | SimValue[] | { [key: string]: SimValue };

/** Each future brain/script instance registers its own continuation state, never a process singleton. */
export interface SimStateAdapter {
  snapshot: () => SimValue; restore: (value: SimValue) => void;
  /** Reconnect saved native handles after world replacement and owner tagging, without allocating or stepping gameplay. */
  physicsRestored?: () => void;
  /** Came to this world after some of its saves were made: a save without it restores, and it stays as it installed. */
  joined?: true;
}
