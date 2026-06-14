import { defineService } from "@chaitin-ai/octobus-sdk";

import { handlers } from "./safeline-waf-eliminate-false-positive.js";

export { handlers } from "./safeline-waf-eliminate-false-positive.js";

export const service = defineService({ handlers });
