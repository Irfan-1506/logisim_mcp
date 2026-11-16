import tempfile
import unittest
from pathlib import Path
from logisim_mcp.core import Store, new_project, synthesize, validate, simulate, find_jar, attrs, circuit

class CoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.store = Store(self.tmp.name)

    def test_path_escape_and_extension(self):
        for path in ["../escape.circ", "project.txt", str(Path(self.tmp.name).parent / 'escape.circ')]:
            with self.assertRaises(ValueError):
                self.store.path(path)

    def test_atomic_edits_backup_and_stale_revision(self):
        first = self.store.write('a.circ', new_project())
        with self.assertRaises(ValueError):
            self.store.edit('a.circ', [
                {'action': 'add_component', 'name': 'Pin', 'at': [100, 100]},
                {'action': 'add_wire', 'points': [[100, 100], [110, 110]]}])
        self.assertEqual(self.store.inspect('a.circ')['sha256'], first['sha256'])
        second = self.store.edit('a.circ', [{'action': 'add_component', 'name': 'Pin', 'at': [100, 100], 'attributes': {'label': 'A&B<"'}}], first['sha256'])
        self.assertTrue(Path(second['backup']).exists())
        self.assertEqual(attrs(circuit(self.store.read('a.circ'), 'main').find('comp'))['label'], 'A&B<"')
        with self.assertRaises(ValueError):
            self.store.edit('a.circ', [{'action': 'add_circuit', 'name': 'other'}], first['sha256'])
        self.assertEqual(len(self.store.read('a.circ').findall('circuit')), 1)

    def test_unknown_native_xml_preserved(self):
        from xml.etree import ElementTree as ET
        root = new_project()
        c = circuit(root, 'main')
        ET.SubElement(ET.SubElement(c, 'appear'), 'circ-port', {'pin': '(100,100)'})
        self.store.write('a.circ', root)
        self.store.edit('a.circ', [{'action': 'add_component', 'name': 'Pin', 'at': [100, 100]}])
        self.assertIsNotNone(circuit(self.store.read('a.circ'), 'main').find('appear/circ-port'))

    def test_expressions_reject_code_and_invalid_inputs(self):
        for expr in ["__import__('os').system('echo unsafe')", "A + B", "unknown", "A.__class__"]:
            with self.assertRaises(ValueError):
                synthesize(['A', 'B'], {'Y': expr})
        with self.assertRaises(ValueError):
            synthesize(['A'], {'A': 'A'})

    def test_subcircuit_cycle_rejected(self):
        self.store.write('a.circ', new_project())
        with self.assertRaises(ValueError):
            self.store.edit('a.circ', [{'action': 'add_component', 'name': 'main', 'at': [100, 100]}])

    def test_full_adder_math(self):
        root, _, rows = synthesize(['A','B','Cin'], {'Sum':'A ^ B ^ Cin','Cout':'(A & B) | (Cin & (A ^ B))'})
        self.assertTrue(validate(root)['valid'])
        for a,b,ci,s,co in rows:
            self.assertEqual(a+b+ci, s+2*co)

    @unittest.skipUnless(find_jar() and find_jar().is_file(), 'Logisim JAR unavailable')
    def test_native_gates_constants_and_failure_detection(self):
        root, vector, _ = synthesize(['A','B'], {'N':'~A', 'And':'A & B', 'Or':'A | B','Xor':'A ^ B', 'Zero':'0','One':'1','Pass':'A'})
        self.store.write('gates.circ', root)
        result = simulate(self.store.path('gates.circ'), 'main', vector)
        self.assertTrue(result['passed'], result['output'])
        bad = 'A B N And Or Xor Zero One Pass\n0 0 0 0 0 0 0 1 0\n'
        result = simulate(self.store.path('gates.circ'), 'main', bad)
        self.assertFalse(result['passed'])
        self.assertEqual(result['failed_rows'], 1)

if __name__ == '__main__':
    unittest.main()
