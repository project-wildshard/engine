// J434 retired the Template as a product: no pin, no grid cell, no product folder. Its gameplay rows (TC-M: the grey
// blob, the Barrow Warden, the whip, the racked iron sword, the lantern, the lift, the chest, the hut door, the talk tape)
// still hold engine facts no other pinned product carries yet. This folder is that product's server half, frozen: the
// server slice (`serverRows`, as `node src/scripts/pins.ts slice` cuts Ring 1's) of the last Template pin, revision 10,
// `cc1fcd3131c2e973…`, 1.3 MB with none of its art. TR-12 moves the gameplay onto Mossgate; when Mossgate is pinned, these
// tests read it and this folder goes (TEMPLATE-E2E TR-5).
export const GAMEPLAY_SLICE = 'test/fixtures/gameplay-slice';
