import { capabilities, runtimeConfig } from '@/lib/server/config';
import { json } from '@/lib/server/errors';
export async function GET(){return json(capabilities(await runtimeConfig()));}
