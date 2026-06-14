import { defineService } from '@chaitin-ai/octobus-sdk';

import { handlers } from './threatbook-onesig.js';

export { handlers } from './threatbook-onesig.js';

export const service = defineService({ handlers });
