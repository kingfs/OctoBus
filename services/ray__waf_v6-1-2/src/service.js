import { defineService } from '@chaitin-ai/octobus-sdk';

import { handlers } from './ray-waf-v6-1-2.js';

export { handlers } from './ray-waf-v6-1-2.js';

export const service = defineService({ handlers });
