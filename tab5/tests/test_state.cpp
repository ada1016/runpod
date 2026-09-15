#include "../esphome/ui_state.h"
#include <cassert>
#include <iostream>
using tab5_v4::State;
std::string ac(int seq,const char *target="26.0",const char *session="boot1",const char *available="1") {
 return "3|D|ac_living|climate|cool|Auto|"+std::string(target)+"|25.0|"+available+"|"+session+"|"+std::to_string(seq);
}
std::string light(int seq,const char *on="1",const char *brightness="50",const char *kelvin="3500") {
 return "3|D|light_living_room|light|"+std::string(on)+"|"+brightness+"|1|"+kelvin+"|boot1|"+std::to_string(seq);
}
int main() {
 State s; s.connection(true,0);
 assert(s.status("ac_living",0)=="Syncing...");
 assert(s.receive(ac(1),100));
 assert(s.temperature_delta("ac_living",.5,200)=="26.5");
 assert(s.temperature_delta("ac_living",.5,210)=="27.0");
 assert(!s.begin("ac_living","ac_power","off",220));
 // Old target and duplicate packets cannot acknowledge newer intent.
 s.mark_sent("ac_living");
 assert(!s.receive(ac(1,"27.0"),300));
 assert(s.receive(ac(2,"26.5"),310)); assert(s.devices["ac_living"].pending);
 assert(s.receive(ac(3,"27.0"),320)); assert(!s.devices["ac_living"].pending);
 assert(s.status("ac_living",320)=="Confirmed by HA");
 assert(s.begin("ac_living","ac_power","off",400)); s.mark_sent("ac_living");
 s.tick(12400); assert(!s.devices["ac_living"].pending);
 assert(s.status("ac_living",12400)=="No confirmation; check device");
 assert(s.receive(light(1),13000));
 assert(s.begin("light_living_room","light_brightness","80",13010)); s.mark_sent("light_living_room");
 assert(s.receive(light(2,"1","79"),13020)); assert(!s.devices["light_living_room"].pending);
 assert(s.begin("light_living_room","light_cct","4500",13030)); s.mark_sent("light_living_room");
 s.receive(light(3,"1","79","3500"),13040); assert(s.devices["light_living_room"].pending);
 s.receive(light(4,"1","79","4500"),13050); assert(!s.devices["light_living_room"].pending);
 assert(s.begin("ac_living","ac_power","off",14000));
 s.connection(false,14010); assert(!s.devices["ac_living"].pending); assert(!s.ready("ac_living",14020));
 s.connection(true,15000); assert(!s.ready("ac_living",15000));
 assert(s.receive(ac(1,"26.0","boot2"),15010));
 assert(s.ready("ac_living",15020)); assert(!s.ready("ac_living",90010));
 assert(s.status("ac_living",90010)=="Stale - waiting for bridge");
 assert(!s.receive("3|D|ac_living|climate|broken",90020));
 assert(s.receive(ac(2,"26.0","boot2","0"),90030)); assert(!s.ready("ac_living",90040));
 assert(s.receive("3|D|temperature_living|sensor|24.1|1|boot2|9",90050));
 // Clock wrap remains safe for both expiry and pending timeout.
 State wrap; wrap.connection(true,0xfffffff0); wrap.receive(ac(1),0xfffffff0);
 assert(wrap.ready("ac_living",100));
 assert(wrap.begin("ac_living","ac_power","off",0xfffffff0));
 wrap.tick(12000); assert(!wrap.devices["ac_living"].pending);
 std::cout << "State scenarios passed: rapid taps, ordering, confirmation, timeout, brightness, CCT, reconnect, stale, unavailable, malformed packets, clock wrap.\n";
}
