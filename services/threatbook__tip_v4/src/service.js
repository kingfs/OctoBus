import { defineService } from '@chaitin-ai/octobus-sdk';

import { handlers } from './threatbook-tip-v4.js';

export { handlers } from './threatbook-tip-v4.js';

export const service = defineService({ handlers });
