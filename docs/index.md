# storagekit

Unified TypeScript file management across multiple storage providers — with
strongly-typed **native provider options** preserved instead of flattened
into a lowest-common-denominator API.

```ts
import { createStorage } from '@mohamedhabibwork/storagekit';

const storage = await createStorage({
  type: 's3',
  bucket: 'uploads',
  region: 'eu-central-1',
});

await storage.upload('users/100/avatar.jpg', fileStream, {
  contentType: 'image/jpeg',
  // normalized, works on every provider
  cacheControl: 'public,max-age=31536000',
  // real AWS options, typed per storage type
  native: {
    StorageClass: 'INTELLIGENT_TIERING',
    ServerSideEncryption: 'AES256',
  },
});
```

Change `type: 's3'` to `type: 'azure'` and TypeScript now offers
Azure-native options (`tier: 'Cool'`, SAS conditions, …) — and **rejects**
AWS ones.

<div class="grid cards" markdown>

-   :material-download:{ .lg .middle } **Install**

    ---

    ```bash
    npm install @mohamedhabibwork/storagekit
    ```

    Works with Node ≥ 20, Bun, and Deno.

-   :material-book-open-page-variant:{ .lg .middle } **Drivers**

    ---

    Per-driver docs in the sidebar: **Local**, **S3**, **MinIO**,
    **Azure Blob**, **Oracle OCI**, plus a guide for **Custom drivers**.

-   :fontawesome-brands-github:{ .lg .middle } **Source**

    ---

    [github.com/mohamedhabibwork/storagekit](https://github.com/mohamedhabibwork/storagekit)

    Issues, releases, and the full project README live there.

-   :fontawesome-brands-npm:{ .lg .middle } **Package**

    ---

    [@mohamedhabibwork/storagekit on npm](https://www.npmjs.com/package/@mohamedhabibwork/storagekit)

    Install, changelog, and unpacked size.

</div>

## Where to next?

| If you want to… | Read |
| --- | --- |
| Use the on-disk filesystem | [Local driver](local.md) |
| Talk to AWS S3 | [AWS S3 driver](s3.md) |
| Talk to MinIO | [MinIO driver](minio.md) |
| Talk to Azure Blob | [Azure Blob driver](azure.md) |
| Talk to Oracle OCI Object Storage | [Oracle OCI driver](oracle.md) |
| Add your own backend | [Custom drivers](custom-drivers.md) |

The full API surface — normalized options, `native` per-driver overrides,
streaming, signed URLs — is described in each driver's page.