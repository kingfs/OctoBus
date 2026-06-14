import { defineService } from '@chaitin-ai/octobus-sdk';

import { handlers } from './panabit-tang-r1.js';

export { handlers } from './panabit-tang-r1.js';

export const service = defineService({ handlers });
