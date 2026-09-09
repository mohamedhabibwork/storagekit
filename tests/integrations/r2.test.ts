import { describe, expect, it } from 'vitest';

import { createR2Storage } from '../../src/drivers/r2/index';

describe('Cloudflare R2 configuration', () => {
  it('derives the standard endpoint and R2 region from an account ID', async () => {
    const storage = await createR2Storage({ type: 'r2', bucket: 'uploads', accountId: 'abc123', credentials: { accessKeyId: 'key', secretAccessKey: 'secret' } });
    const client = storage.native();
    expect(await client.config.region()).toBe('auto');
    expect(client.config.forcePathStyle).toBe(false);
    expect(client.config.endpoint).toBeDefined();
    expect(await client.config.endpoint!()).toMatchObject({ protocol: 'https:', hostname: 'abc123.r2.cloudflarestorage.com' });
    expect(storage.capabilities().versioning).toBe(false);
  });

  it('requires an account ID, endpoint, or injected client', async () => {
    await expect(createR2Storage({ type: 'r2', bucket: 'uploads' })).rejects.toThrow(/accountId.*endpoint.*client/);
  });
});
