"""Offline behavioral tests: no HA connection and no real service calls."""
import importlib.util
from pathlib import Path
import sys
import types
import unittest

for name in ('appdaemon', 'appdaemon.plugins', 'appdaemon.plugins.hass', 'appdaemon.plugins.hass.hassapi'):
    sys.modules[name] = types.ModuleType(name)
sys.modules['appdaemon.plugins.hass.hassapi'].Hass = object
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('bridge', ROOT / 'appdaemon/tab5_bridge_v4.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class TestBridge(unittest.TestCase):
    def setUp(self):
        self.b = module.Tab5V4Bridge()
        self.b.devices = {'ac_living': 'climate.living', 'light_living_room': 'light.living', 'temperature_living': 'sensor.temp'}
        self.b._seq = 0
        self.b._session = 'testboot'
        self.states = {
            'climate.living': {'state': 'cool', 'attributes': {'temperature': 26.0, 'fan_mode': 'Auto'}},
            'light.living': {'state': 'on', 'attributes': {'brightness': 128, 'color_temp_kelvin': 3500}},
            'sensor.temp': {'state': '24.2', 'attributes': {}},
        }
        self.published, self.calls, self.timers = {}, [], []
        def get_state(entity, attribute=None):
            obj = self.states.get(entity, {})
            if attribute == 'all': return obj
            if attribute: return obj.get('attributes', {}).get(attribute)
            return obj.get('state')
        self.b.get_state = get_state
        self.b.set_state = lambda entity, **kw: self.published.update({entity: kw})
        self.b.call_service = lambda name, **kw: self.calls.append((name, kw))
        self.b.run_in = lambda callback, delay, **kw: self.timers.append((callback, delay, kw))
        self.b.log = lambda *args, **kw: None

    def command(self, **data): self.b._command('esphome.tab5_v4_command', data, {})

    def test_initialize_isolated_and_periodic(self):
        required=['ac_brother','ac_sister','ac_parents','ac_living',
                  'light_bedroom_window','light_living_room','light_da_head','light_da_foot',
                  'light_da_desk','light_am_door','light_am_foot','light_am_desk']
        self.b.args={k: ('climate.' if k.startswith('ac_') else 'light.')+k for k in required}
        events, subscriptions, recurring = [], [], []
        self.b.listen_event=lambda callback,event: events.append(event)
        self.b.listen_state=lambda callback,entity,**kw: subscriptions.append((entity,kw))
        self.b.run_every=lambda callback,start,interval: recurring.append(interval)
        self.b.initialize()
        self.assertEqual(events,['esphome.tab5_v4_command'])
        self.assertEqual(recurring,[30])
        self.assertEqual(len(subscriptions),13)  # 12 devices + existing gas helper
        self.assertFalse(self.calls)

    def test_snapshot_retains_each_device(self):
        for key in self.b.devices: self.b._publish_device(key)
        self.assertEqual(len(self.published), 3)
        packet = self.published['sensor.tab5_v4_light_living_room']['state'].split('|')
        self.assertEqual(packet[7], '3500')
        self.assertEqual(packet[-2], 'testboot')
        self.assertEqual(len(packet), 10)
        self.assertEqual(len(self.published['sensor.tab5_v4_ac_living']['state'].split('|')), 11)
        self.assertEqual(len(self.published['sensor.tab5_v4_temperature_living']['state'].split('|')), 8)

    def test_explicit_power_is_idempotent(self):
        for _ in range(2): self.command(action='ac_power', device='ac_living', value='off')
        self.assertEqual([c[0] for c in self.calls], ['climate/turn_off'] * 2)

    def test_absolute_temperature(self):
        self.command(action='ac_set_temperature', device='ac_living', value='27.5')
        self.assertEqual(self.calls[0][1]['temperature'], 27.5)

    def test_group_action_reachable(self):
        self.command(action='ac_group_toggle', devices='ac_living')
        self.assertEqual(self.calls[0][0], 'climate/turn_off')

    def test_unknown_key_does_not_control_device(self):
        self.command(action='ac_power', device='missing', value='on')
        self.assertFalse(self.calls)

    def test_refresh_only_publishes_no_service_call(self):
        self.command(action='refresh_devices', devices='ac_living,light_living_room')
        self.assertEqual(len(self.published), 2)
        self.assertFalse(self.calls)

    def test_bootstrap_includes_all_devices(self):
        self.b._bootstrap_publish({})
        keys = [kw['device_key'] for _, _, kw in self.timers if 'device_key' in kw]
        self.assertCountEqual(keys, self.b.devices)

if __name__ == '__main__': unittest.main()
