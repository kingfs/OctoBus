import { defineService } from "@chaitin-ai/octobus-sdk";

import { handlers } from "./feishu-group-robot.js";

export { handlers } from "./feishu-group-robot.js";

export const service = defineService({ handlers });
