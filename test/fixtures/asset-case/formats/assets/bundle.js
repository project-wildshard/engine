const boot = `/assets/music/theme.mp3,/assets/music/absent.mp3,/assets/Music/theme.mp3`.split(`,`);
const style = {
  keys: { dawn: { id: `dawn` }, missing: { id: `absent` }, wrong: { id: `Wrong` } },
  keyFiles: { color: `/assets/hdri/{id}.jpg` },
};
const direct = `/assets/music/comma,file.mp3`;
const unresolved = { keyFiles: { color: `/assets/unknown/{id}.jpg` } };
const tiers = `phone,desktop`.split(`,`);
tiers.map((tier) => `/assets/packs/demo.${tier}.bin`);
void boot;
void style;
void direct;
void unresolved;
