const tiers = ['phone', 'desktop'];
tiers.map((tier) => `/assets/packs/demo.${tier}.bin`);
const unknownKind = (kind) => `/assets/Music/${kind}.mp3`;
const directory = (kind) => `/assets/music/${kind}/`;
const single = '/assets/packs/demo.phone.bin?version=2';
const escaped = '\u002fassets/music/theme.mp3';
const regexOnly = /\/assets\/music\/not-a-url/;
// '/assets/music/not-a-reference.mp3'
