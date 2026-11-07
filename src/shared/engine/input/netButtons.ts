// P1-E5.2 (E5-REPLICATION §4.2): a NetCommand's `buttons` field. Here, not in net/, because the sim reads them and the
// shipped client carries the sim but not yet the wire.
/** The command's button bits. */
export const NET_BUTTONS = { jump: 1, dodge: 2, hover: 4, sprint: 8, crouch: 16, dive: 32, surface: 64, heavy: 128, lock: 256, skip: 512, boost: 1024, secondary: 2048 } as const;
