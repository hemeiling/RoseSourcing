// Simplified Chinese for every interface text, keyed by its English. One file per area of the app; when two files have
// the same key the later one wins, so put shared words in common.ts and reuse them.

import { account } from "./account";
import { common } from "./common";
import { competitors } from "./competitors";
import { economicsBrand } from "./economics-brand";
import { fitChannels } from "./fit-channels";
import { market } from "./market";
import { report } from "./report";
import { suppliers } from "./suppliers";

export const zh = { ...common, ...account, ...report, ...market, ...competitors, ...suppliers, ...fitChannels, ...economicsBrand };
