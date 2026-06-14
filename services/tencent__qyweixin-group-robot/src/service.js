import { defineService } from '@chaitin-ai/octobus-sdk';

import { handlers } from './tencent-qyweixin-group-robot.js';

export { handlers } from './tencent-qyweixin-group-robot.js';

export const service = defineService({ handlers });
