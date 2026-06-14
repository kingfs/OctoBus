import { defineService } from '@chaitin-ai/octobus-sdk';

import { handlers } from './threatbook-tdp.js';

export { handlers } from './threatbook-tdp.js';

export const service = defineService({ handlers });
