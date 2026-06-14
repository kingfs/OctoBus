import { defineService } from '@chaitin-ai/octobus-sdk';

import { handlers } from './topsec-fw-2u.js';

export { handlers } from './topsec-fw-2u.js';

export const service = defineService({ handlers });
