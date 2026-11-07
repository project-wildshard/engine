import { installPortableMath } from './portableMath';

// Import this first: a module's body may read Math (a table, a constant), so the sim's Math goes in before any of them runs.
installPortableMath();
