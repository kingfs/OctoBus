import { defineService } from "@chaitin-ai/octobus-sdk";

import { handlers } from "./dingtalk-group-robot.js";

export { handlers } from "./dingtalk-group-robot.js";

export const service = defineService({ handlers });
