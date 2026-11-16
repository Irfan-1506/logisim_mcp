"""Exercise the actual stdio protocol in a fresh server process."""
import asyncio
import os
import sys
import tempfile
import unittest
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

class ProtocolTests(unittest.TestCase):
    def test_stdio_roundtrip(self):
        asyncio.run(self.roundtrip())

    async def roundtrip(self):
        with tempfile.TemporaryDirectory() as workspace:
            params = StdioServerParameters(command=sys.executable, args=['-m','logisim_mcp.server'], env={**os.environ, 'LOGISIM_WORKSPACE': workspace})
            async with stdio_client(params) as (read, write):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    names = {t.name for t in (await session.list_tools()).tools}
                    self.assertIn('synthesize_logic', names)
                    self.assertIn('edit_project', names)
                    result = await session.call_tool('synthesize_logic', {'path':'test.circ','inputs':['A','B'],'outputs':{'Y':'A ^ B'}, 'verify':False})
                    self.assertFalse(result.isError, result)
                    result = await session.call_tool('inspect_project', {'path':'test.circ'})
                    self.assertFalse(result.isError, result)
                    result = await session.call_tool('create_project', {'path':'../escape.circ'})
                    self.assertTrue(result.isError)
                    result = await session.call_tool('import_project_xml', {'path':'evil.circ','xml':'<!DOCTYPE project [<!ENTITY x "test">]><project>&x;</project>'})
                    self.assertTrue(result.isError)
                    self.assertTrue((await session.list_resources()).resources)
                    self.assertTrue((await session.list_prompts()).prompts)
