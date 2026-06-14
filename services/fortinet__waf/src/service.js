import { defineService } from "@chaitin-ai/octobus-sdk";

import { handlers } from "./fortinet-waf.js";

export { handlers } from "./fortinet-waf.js";

export const service = defineService({ handlers });
