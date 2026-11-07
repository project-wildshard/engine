// Existing test/oracle entry: the identical defining math is shared by cold authoring jobs.
// oxlint-disable-next-line unicorn/prefer-export-from -- Keep stable test bindings while the project forbids own-module reexports.
import { installPortableMath as install, withPortableMath as scoped, portableMath as functions } from '@wildshard/commons/bake/portableMath';

export const installPortableMath = install;
export const withPortableMath = scoped;
export const portableMath = functions;
