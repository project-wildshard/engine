// P1-E5.2c (J110): the word filter's list, its own file so moderation can change it without touching the code. Entries are
// lower case; the filter folds case, look-alike digits and stretched letters before it compares whole words.
export const CHAT_WORDS: readonly string[] = [
  'arse', 'arsehole', 'ass', 'asshole', 'bastard', 'bitch', 'bollocks', 'bullshit', 'cock', 'cunt', 'dick', 'dickhead',
  'fag', 'faggot', 'fuck', 'fucker', 'fucking', 'kike', 'motherfucker', 'nigga', 'nigger', 'paki', 'piss', 'prick',
  'pussy', 'rape', 'rapist', 'retard', 'shit', 'shitty', 'slut', 'spic', 'tranny', 'twat', 'wank', 'wanker', 'whore',
];
