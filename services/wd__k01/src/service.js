import { defineService } from '@chaitin-ai/octobus-sdk';

import { handlers } from './wd-k01.js';

export { handlers } from './wd-k01.js';

export const service = defineService({ handlers });
