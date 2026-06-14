import { defineService } from '@chaitin-ai/octobus-sdk';

import { handlers } from './qiming-tianqing-waf.js';

export { handlers } from './qiming-tianqing-waf.js';

export const service = defineService({ handlers });
