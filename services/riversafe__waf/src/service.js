import { defineService } from '@chaitin-ai/octobus-sdk';

import { handlers } from './riversafe-waf.js';

export { handlers } from './riversafe-waf.js';

export const service = defineService({ handlers });
