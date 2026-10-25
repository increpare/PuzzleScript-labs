import path from 'node:path';
import { root } from './build-mis-web.mjs';
import { serve } from './gui95-serve.mjs';
await serve({ root: path.join(root, 'build/mis-web'), entry: 'mis.html', port: Number(process.env.PORT || process.env.MIS_WEB_PORT || 8000), label: 'MIS95' });
