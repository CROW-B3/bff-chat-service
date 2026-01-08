import process from 'node:process';
import { drizzleD1Config } from '@deox/drizzle-d1-utils';

export default drizzleD1Config(
  {
    out: './drizzle/migrations',
    schema: './src/db/schema.ts',
  },
  {
    accountId: process.env.CLOUDFLARE_D1_ACCOUNT_ID,
    apiToken: process.env.CLOUDFLARE_D1_API_TOKEN,
    databaseId: '45b02f1a-9d64-48b1-bd7a-9a78999d1f66',
    binding: 'DB',
    remote: process.env.REMOTE === 'true' || process.env.REMOTE === '1',
  }
);
