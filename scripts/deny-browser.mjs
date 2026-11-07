// DS1.5 build preloader: importing browser APIs is allowed; starting or connecting to a browser is refused.
import { chromium, firefox, webkit } from 'playwright';

const refuse = () => { throw new Error('DS1.5: browsers are disabled during this build'); };
for (const type of [chromium, firefox, webkit]) {
  type.launch = refuse;
  type.launchPersistentContext = refuse;
  type.launchServer = refuse;
  Reflect.set(type, 'connect', refuse);
}
Reflect.set(chromium, 'connectOverCDP', refuse);
