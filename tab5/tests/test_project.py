"""Structural isolation and wiring tests; requires the build environment's PyYAML."""
from pathlib import Path
import ast
import hashlib
import unittest
import yaml

ROOT = Path(__file__).resolve().parents[1]
EXP = ROOT

class TaggedLoader(yaml.SafeLoader): pass
TaggedLoader.add_multi_constructor('!', lambda loader, tag, node: loader.construct_scalar(node) if isinstance(node, yaml.ScalarNode) else loader.construct_sequence(node) if isinstance(node, yaml.SequenceNode) else loader.construct_mapping(node))

class ProjectTest(unittest.TestCase):
    def test_all_yaml_parses(self):
        for p in (EXP/'esphome').rglob('*.yaml'):
            if '.esphome' not in p.parts: yaml.load(p.read_text(), Loader=TaggedLoader)

    def test_no_original_command_channel(self):
        for p in (EXP/'esphome').rglob('*.yaml'):
            if '.esphome' not in p.parts: self.assertNotIn('esphome.tab5_command', p.read_text(), str(p))
        self.assertNotIn('"esphome.tab5_command"', (EXP/'appdaemon/tab5_bridge_v4.py').read_text())

    def test_app_config_merge_only(self):
        config=yaml.load((EXP/'appdaemon/apps.yaml').read_text(),Loader=TaggedLoader)
        self.assertEqual(list(config),['tab5_v4_bridge'])
        self.assertEqual(config['tab5_v4_bridge']['class'],'Tab5V4Bridge')

    def test_gas_unchanged(self):
        self.assertEqual(hashlib.sha256((EXP/'appdaemon/gas_meter.py').read_bytes()).hexdigest(), '8c7bd3cbe508c66b6f2fa23bbd7fea08e254647a8c5cdae8cba5ea9fe010dc7c')

    def test_every_cache_has_separate_subscription(self):
        config=yaml.load((EXP/'esphome/tab5-v4-lab.yaml').read_text(),Loader=TaggedLoader)
        keys={g['id'][6:] for g in config['globals'] if g['id'].startswith('cache_')}
        subs=yaml.load((EXP/'esphome/bridge/v4_subscriptions.yaml').read_text(),Loader=TaggedLoader)
        entities={s['entity_id'] for s in subs['text_sensor']}
        self.assertTrue({'sensor.tab5_v4_'+k for k in keys}.issubset(entities))
        self.assertEqual(len(entities),26)

    def test_python_syntax(self):
        for p in (EXP/'appdaemon').glob('*.py'): ast.parse(p.read_text())

if __name__=='__main__':unittest.main()
