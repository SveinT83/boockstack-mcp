import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { fixture, token, alice, aliceKey } from './helpers.js';

for (const [mode, expectedVersion] of [
  ['legacy', '2025-11-25'],
  [{ pin: '2026-07-28' }, '2026-07-28'],
] as const)
  test(`official MCP v2 client over real HTTP: ${expectedVersion}`, async () => {
    const f = fixture(async () =>
      Response.json({ id: 5, name: 'Local mock page', markdown: '# Test' }),
    );
    f.store.save(alice, aliceKey, 'v26.09.2');
    // Local proxy harness supplies the configured public Host just as HTTPS proxying does.
    const server = createHttpServer((req, res) => {
      req.headers.host = f.host;
      f.app(req, res);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const client = new Client(
      { name: 'local-integration-test', version: '1.0.0' },
      { versionNegotiation: { mode } },
    );
    try {
      const url = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`);
      const transport = new StreamableHTTPClientTransport(url, {
        requestInit: { headers: { Authorization: `Bearer ${await token()}` } },
      });
      await client.connect(transport);
      assert.equal(transport.protocolVersion, expectedVersion);
      const tools = await client.listTools();
      assert.equal(tools.tools.length, 8);
      const result = await client.callTool({
        name: 'bookstack_read',
        arguments: { kind: 'pages', id: 5 },
      });
      assert(!result.isError);
      const content = result.content as { type: string; text: string }[];
      assert.equal(JSON.parse(content[0]!.text).data.name, 'Local mock page');
    } finally {
      await client.close();
      server.close();
      server.closeAllConnections();
      await once(server, 'close');
      await f.close();
    }
  });
