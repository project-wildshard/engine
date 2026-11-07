import {defineConfig} from 'vitest/config';
import base from '../vitest.config';
import {CI_SERIAL_TESTS} from './vitest-ci-files';

// Same setup and native controls, without sibling workers contending for disk.
const config=defineConfig({...base,test:{...base.test,include:[...CI_SERIAL_TESTS],
  isolate:true,pool:'forks',maxWorkers:1}});
// oxlint-disable-next-line import/no-default-export -- Vitest reads this config's default export.
export default config;
