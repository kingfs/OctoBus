import { defineService } from '@chaitin-ai/octobus-sdk';

import { handlers } from './skycloud-inet.js';

export { handlers } from './skycloud-inet.js';

export const service = defineService({ handlers });
