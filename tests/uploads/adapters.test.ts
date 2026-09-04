import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import http from 'node:http';
import { Readable } from 'node:stream';

import express from 'express';
import multer from 'multer';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { Hono } from 'hono';
import formidable from 'formidable';

import { createLocalStorage } from '../../src/drivers/local';
import { createMulterStorage } from '../../src/adapters/express';
import { saveFastifyFile } from '../../src/adapters/fastify';
import { saveFormidableFile } from '../../src/adapters/formidable';
import { saveWebFile } from '../../src/uploads';
import type { Storage } from '../../src/core/types';

let root: string;
let storage: Storage<'local'>;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'storagekit-uploads-'));
  storage = await createLocalStorage({ type: 'local', root });
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Start a Node http server on an ephemeral port and return its base URL. */
async function listen(server: http.Server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

function multipartForm(parts: Record<string, File | string>): FormData {
  const form = new FormData();
  for (const [name, value] of Object.entries(parts)) {
    form.append(name, value);
  }
  return form;
}

describe('express + multer engine', () => {
  it('stores uploads streamed straight to storage and exposes the key on req.file', async () => {
    const app = express();
    const upload = multer({
      storage: createMulterStorage(storage, { directory: 'express' }),
    });

    app.post('/single', upload.single('file'), (req, res) => {
      const file = (req as unknown as { file: Record<string, unknown> }).file;
      res.json({
        key: file!.key,
        storagekitKey: (file!.storagekit as { key: string }).key,
        originalname: file!.originalname,
        size: file!.size,
      });
    });

    const server = app.listen(0, '127.0.0.1');
    const base = await listen(server);
    try {
      const response = await fetch(`${base}/single`, {
        method: 'POST',
        body: multipartForm({
          file: new File([Buffer.from('hello from express')], 'greeting.txt', {
            type: 'text/plain',
          }),
        }),
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;

      expect(body.key).toMatch(/^express\/[0-9a-f-]{36}\.txt$/);
      expect(body.storagekitKey).toBe(body.key);
      expect(body.originalname).toBe('greeting.txt');

      const download = await storage.download(body.key as string);
      expect(await download.text()).toBe('hello from express');
      expect(download.contentType).toBe('text/plain');
    } finally {
      server.close();
    }
  });

  it('handles multiple files via upload.array and key resolvers', async () => {
    const app = express();
    const upload = multer({
      storage: createMulterStorage(storage, {
        key: (file) => `named/${file.fieldname}-${file.originalName}`,
      }),
    });

    app.post('/many', upload.array('docs', 2), (req, res) => {
      const files = (req as unknown as { files: Array<Record<string, unknown>> }).files;
      res.json({ keys: files!.map((f) => f.key) });
    });

    const server = app.listen(0, '127.0.0.1');
    const base = await listen(server);
    try {
      const form = multipartForm({
        ignored: 'text field',
      });
      form.append('docs', new File([Buffer.from('first')], 'a.txt'));
      form.append('docs', new File([Buffer.from('second')], 'b.txt'));
      const response = await fetch(`${base}/many`, { method: 'POST', body: form });
      expect(response.status).toBe(200);
      const { keys } = (await response.json()) as { keys: string[] };

      expect(keys).toEqual(['named/docs-a.txt', 'named/docs-b.txt']);
      expect(await (await storage.download(keys[0]!)).text()).toBe('first');
      expect(await (await storage.download(keys[1]!)).text()).toBe('second');
    } finally {
      server.close();
    }
  });

  it('forwards key failures to the express error handler', async () => {
    const app = express();
    const upload = multer({
      storage: createMulterStorage(storage, {
        key: () => {
          throw new Error('key rejected');
        },
      }),
    });

    app.post('/boom', upload.single('file'), (_req, res) => {
      res.json({ ok: true });
    });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    app.use((error: Error, _req: unknown, res: unknown, _next: unknown) => {
      (res as { status: (n: number) => { json: (b: unknown) => void } })
        .status(500)
        .json({ error: error.message });
    });

    const server = app.listen(0, '127.0.0.1');
    const base = await listen(server);
    try {
      const response = await fetch(`${base}/boom`, {
        method: 'POST',
        body: multipartForm({ file: new File(['x'], 'x.txt') }),
      });
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: 'key rejected' });
    } finally {
      server.close();
    }
  });

  it('removes the stored object when multer calls _removeFile (request aborted)', async () => {
    const engine = createMulterStorage(storage, { directory: 'cleanup' });
    const file = {
      fieldname: 'file',
      originalname: 'temp.txt',
      stream: Readable.from(Buffer.from('to be removed')),
    };

    const stored = await new Promise<Record<string, unknown>>((resolve, reject) => {
      engine._handleFile({}, file as never, (error, info) =>
        error ? reject(error) : resolve(info as Record<string, unknown>),
      );
    });
    const key = stored.key as string;
    expect(await storage.exists(key)).toBe(true);

    await new Promise<void>((resolve, reject) => {
      engine._removeFile({}, file as never, (error) => (error ? reject(error) : resolve()));
    });
    expect(await storage.exists(key)).toBe(false);
  });
});

describe('fastify + @fastify/multipart', () => {
  it('stores streamed parts and returns the saved upload', async () => {
    const app = Fastify();
    await app.register(multipart);

    app.post('/upload', async (req, reply) => {
      const part = await req.file();
      if (!part) return reply.code(400).send({ error: 'missing file' });
      const saved = await saveFastifyFile(storage, part, { directory: 'fastify' });
      return reply.send({
        key: saved.key,
        name: saved.originalName,
        mime: saved.mimeType,
      });
    });

    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address() as AddressInfo;
    try {
      const response = await fetch(
        `http://127.0.0.1:${address.port}/upload`,
        {
          method: 'POST',
          body: multipartForm({
            file: new File([Buffer.from('fastify payload')], 'report.csv', {
              type: 'text/csv',
            }),
          }),
        },
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, string>;

      expect(body.key).toMatch(/^fastify\/[0-9a-f-]{36}\.csv$/);
      expect(body.name).toBe('report.csv');
      expect(body.mime).toBe('text/csv');

      const download = await storage.download(body.key);
      expect(await download.text()).toBe('fastify payload');
    } finally {
      await app.close();
    }
  });
});

describe('hono (web File/Blob)', () => {
  it('stores files parsed by hono via saveWebFile', async () => {
    const app = new Hono();

    app.post('/upload', async (c) => {
      const body = await c.req.parseBody();
      const file = body['file'];
      if (!(file instanceof File)) return c.json({ error: 'missing file' }, 400);
      const saved = await saveWebFile(storage, file, { directory: 'hono' });
      return c.json({ key: saved.key, name: saved.originalName, mime: saved.mimeType });
    });

    const response = await app.request('/upload', {
      method: 'POST',
      body: multipartForm({
        file: new File([Buffer.from('hono bytes')], 'image.png', { type: 'image/png' }),
      }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, string>;

    expect(body.key).toMatch(/^hono\/[0-9a-f-]{36}\.png$/);
    expect(body.name).toBe('image.png');
    expect(body.mime).toBe('image/png');

    const download = await storage.download(body.key);
    expect(await download.text()).toBe('hono bytes');
  });
});

describe('formidable', () => {
  it('streams formidable temp files into storage', async () => {
    const server = http.createServer((req, res) => {
      const form = formidable({ uploadDir: root, keepExtensions: true });
      form.parse(req, async (error, _fields, files) => {
        if (error) {
          res.statusCode = 500;
          res.end('parse failed');
          return;
        }
        const raw = (files as Record<string, unknown>).file;
        const upload = Array.isArray(raw) ? raw[0] : raw;
        if (!upload) {
          res.statusCode = 400;
          res.end('missing file');
          return;
        }
        const saved = await saveFormidableFile(storage, upload, {
          directory: 'formidable',
        });
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ key: saved.key, name: saved.originalName }));
      });
    });

    const base = await listen(server);
    try {
      const response = await fetch(`${base}/`, {
        method: 'POST',
        body: multipartForm({
          file: new File([Buffer.from('formidable bytes')], 'data.json', {
            type: 'application/json',
          }),
        }),
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, string>;

      expect(body.key).toMatch(/^formidable\/[0-9a-f-]{36}\.json$/);
      expect(body.name).toBe('data.json');

      const download = await storage.download(body.key);
      expect(await download.text()).toBe('formidable bytes');
    } finally {
      server.close();
    }
  });
});
