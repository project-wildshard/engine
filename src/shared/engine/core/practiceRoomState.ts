/** Shared practice admission state. The page's existing event owner writes it;
 * renderer-free discovery reads the same object without installing DOM work. */
export const practiceRoomState = {open:false};
