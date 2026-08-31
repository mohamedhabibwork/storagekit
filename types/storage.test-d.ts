import { describe, expectTypeOf, it } from 'vitest';
import type { S3Client } from '@aws-sdk/client-s3';
import type { ContainerClient } from '@azure/storage-blob';
import type { Client as MinioClient } from 'minio';
import type { ObjectStorageClient } from 'oci-objectstorage';

import { createStorage, createStorageManager } from '../src/index';
import { createS3Storage } from '../src/drivers/s3/index';
import { createAzureStorage } from '../src/drivers/azure/index';
import { createMinioStorage } from '../src/drivers/minio/index';
import { createLocalStorage } from '../src/drivers/local/index';
import { createOracleStorage, type OracleStorage } from '../src/drivers/oracle/index';
import type { Storage } from '../src/index';
import type { LocalNativeClient } from '../src/drivers/local/local.types';

describe('factory typing', () => {
  it('infers Storage<type> from the config discriminant', () => {
    expectTypeOf(createStorage({ type: 's3', bucket: 'b' })).toEqualTypeOf<
      Promise<Storage<'s3'>>
    >();
    expectTypeOf(createStorage({ type: 'azure', container: 'c', accountUrl: 'u' })).toEqualTypeOf<
      Promise<Storage<'azure'>>
    >();
    expectTypeOf(createStorage({ type: 'minio', endPoint: 'h', bucket: 'b' })).toEqualTypeOf<
      Promise<Storage<'minio'>>
    >();
    expectTypeOf(createStorage({ type: 'local', root: '.' })).toEqualTypeOf<
      Promise<Storage<'local'>>
    >();
    expectTypeOf(
      createStorage({ type: 'oracle', namespaceName: 'ns', bucketName: 'b' }),
    ).toEqualTypeOf<Promise<Storage<'oracle'>>>();
  });

  it('rejects cross-provider config fields', () => {
    // @ts-expect-error endPoint belongs to minio, not s3
    createStorage({ type: 's3', bucket: 'b', endPoint: 'h' });
    // @ts-expect-error container belongs to azure
    createStorage({ type: 's3', bucket: 'b', container: 'c' });
  });
});

describe('native option typing', () => {
  const s3 = {} as Storage<'s3'>;
  const azure = {} as Storage<'azure'>;
  const minio = {} as Storage<'minio'>;
  const local = {} as Storage<'local'>;

  it('accepts real AWS options on Storage<"s3">', () => {
    s3.upload('a', Buffer.alloc(0), {
      contentType: 'image/jpeg',
      native: {
        StorageClass: 'INTELLIGENT_TIERING',
        ServerSideEncryption: 'AES256',
        ACL: 'private',
      },
    });
    s3.getSignedUrl('a', {
      expiresIn: 60,
      native: { ResponseContentDisposition: 'attachment; filename="a.pdf"' },
    });
  });

  it('rejects provider-native options on the wrong storage type', () => {
    // @ts-expect-error `tier` is an Azure option, not an S3 one
    s3.upload('a', Buffer.alloc(0), { native: { tier: 'Cool' } });
    // @ts-expect-error `metaData` is a MinIO option, not an S3 one
    s3.upload('a', Buffer.alloc(0), { native: { metaData: {} } });
    // @ts-expect-error `StorageClass` is an S3 option, not an Azure one
    azure.upload('a', Buffer.alloc(0), { native: { StorageClass: 'STANDARD_IA' } });
    // @ts-expect-error unknown native keys are rejected on minio too
    minio.upload('a', Buffer.alloc(0), { native: { StorageClass: 'STANDARD_IA' } });
    // @ts-expect-error the local driver has no `tier` option
    local.upload('a', Buffer.alloc(0), { native: { tier: 'Cool' } });
  });

  it('keeps common options available everywhere', () => {
    s3.upload('a', 'x', { cacheControl: 'no-cache', metadata: { a: 'b' }, overwrite: false });
    azure.upload('a', 'x', { cacheControl: 'no-cache', multipart: { partSize: 1024 } });
  });
});

describe('native client typing', () => {
  it('returns the provider SDK client from native()', () => {
    const s3 = {} as Storage<'s3'>;
    const azure = {} as Storage<'azure'>;
    const minio = {} as Storage<'minio'>;
    const oracle = {} as Storage<'oracle'>;
    const local = {} as Storage<'local'>;

    expectTypeOf(s3.native()).toEqualTypeOf<S3Client>();
    expectTypeOf(azure.native()).toEqualTypeOf<ContainerClient>();
    expectTypeOf(minio.native()).toEqualTypeOf<MinioClient>();
    expectTypeOf(oracle.native()).toEqualTypeOf<ObjectStorageClient>();
    expectTypeOf(local.native()).toEqualTypeOf<LocalNativeClient>();
  });
});

describe('provider entrypoints', () => {
  it('return provider-typed storages', () => {
    expectTypeOf(createS3Storage({ type: 's3', bucket: 'b' })).toEqualTypeOf<
      Promise<Storage<'s3'>>
    >();
    expectTypeOf(createAzureStorage({ type: 'azure', container: 'c' })).resolves.toMatchTypeOf<
      Storage<'azure'>
    >();
    expectTypeOf(createMinioStorage({ type: 'minio', endPoint: 'h', bucket: 'b' })).toEqualTypeOf<
      Promise<Storage<'minio'>>
    >();
    expectTypeOf(createLocalStorage({ type: 'local', root: '.' })).toEqualTypeOf<
      Promise<Storage<'local'>>
    >();
    expectTypeOf(
      createOracleStorage({ type: 'oracle', namespaceName: 'n', bucketName: 'b' }),
    ).resolves.toMatchTypeOf<OracleStorage>();
  });
});

describe('storage manager typing', () => {
  it('keys disks to their configured provider', async () => {
    const manager = createStorageManager({
      default: 'uploads',
      disks: {
        uploads: { type: 's3', bucket: 'uploads' },
        backup: { type: 'azure', container: 'backup', accountUrl: 'https://acct.blob.core.windows.net' },
        scratch: { type: 'local', root: '/tmp' },
      },
    });

    const uploads = await manager.disk('uploads');
    const backup = await manager.disk('backup');
    const scratch = await manager.disk('scratch');

    expectTypeOf(uploads.native()).toEqualTypeOf<S3Client>();
    expectTypeOf(backup.native()).toEqualTypeOf<ContainerClient>();
    expectTypeOf(scratch.native()).toEqualTypeOf<LocalNativeClient>();

    // @ts-expect-error unknown disk names are rejected
    manager.disk('nope');
  });
});

describe('custom driver types', () => {
  it('infers Storage<customType> for registered drivers', () => {
    expectTypeOf(
      createStorage({ type: 'postgres', connectionString: 'postgres://' }),
    ).toEqualTypeOf<Promise<Storage<'postgres'>>>();

    const custom = {} as Storage<'postgres'>;
    // native slots fall back to unknown for custom types
    expectTypeOf(custom.native()).toEqualTypeOf<unknown>();
    // arbitrary custom native bags are accepted
    custom.upload('a', 'x', { native: { table: 'objects' } });
  });

  it('rejects custom configs without a type discriminant', () => {
    // @ts-expect-error custom configs still need `type`
    createStorage({ engine: 'postgres' });
  });
});
