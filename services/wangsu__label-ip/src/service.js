import { defineService } from '@chaitin-ai/octobus-sdk';

import { handlers } from './wangsu-label-ip.js';

export { handlers } from './wangsu-label-ip.js';

export const service = defineService({ handlers });
