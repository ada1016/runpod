#include "../esphome/ui_state.h"
#include <cassert>
#include <iostream>
using namespace tab5_v4;
std::string light(const std::string &key,int seq,bool on=false,int bri=0,bool available=true) {
 return "3|D|"+key+"|light|"+(on?"1":"0")+"|"+std::to_string(bri)+"|"+(available?"1":"0")+"|3500|session|"+std::to_string(seq);
}
std::string ac(const std::string &key,int seq,const std::string &target="26.0") {
 return "3|D|"+key+"|climate|cool|Auto|"+target+"|25.0|1|session|"+std::to_string(seq);
}
int main() {
 const std::string group="light_da_head,light_da_foot,light_da_desk";
 State s;s.connection(true,0);
 s.receive(light("light_da_head",1),0);s.receive(light("light_da_foot",1),0);
 s.receive(light("light_da_desk",1,false,0,false),0);
 assert(s.submit(group,"light_power","on",10));
 Command c;int sent=0;
 while(s.next_command(100,c)) {assert(c.key!="light_da_desk");assert(c.value=="on");sent++;}
 assert(sent==2);
 s.receive(light("light_da_head",2,true,100),200);s.tick(200);
 assert(s.group_status(group,200)=="1/3 confirmed; waiting");
 s.receive(light("light_da_foot",2,true,100),210);s.tick(210);
 assert(s.group_status(group,210)=="2/3 confirmed; 1 skipped");
 // A device coming online later must never receive a stale group command.
 s.receive(light("light_da_desk",2),220);assert(!s.next_command(230,c));
 assert(s.group_status("light_da_desk, light_da_foot,light_da_head,light_da_head",230)=="2/3 confirmed; 1 skipped");
 assert(s.submit(group,"light_power","off",300));
 assert(!s.submit("light_da_head","light_brightness","70",310));
 while(s.next_command(400,c)) {}
 s.receive(light("light_da_head",3),410);s.receive(light("light_da_foot",3),420);
 s.tick(12400);assert(s.group_status(group,12400)=="2/3 confirmed; check rest");
 // Independent room temperature requests survive navigation and debounce separately.
 State rooms;rooms.connection(true,0);rooms.receive(ac("ac_parents",1),0);rooms.receive(ac("ac_darren",1),0);
 assert(rooms.submit("ac_parents","ac_temp_delta","0.5",10));
 assert(rooms.submit("ac_parents","ac_temp_delta","0.5",20));
 assert(rooms.submit("ac_darren","ac_temp_delta","-0.5",30));
 assert(!rooms.next_command(360,c));
 assert(rooms.next_command(370,c));assert(c.key=="ac_parents" && c.value=="27.0");
 assert(rooms.next_command(380,c));assert(c.key=="ac_darren" && c.value=="25.5");
 assert(!rooms.next_command(500,c));
 // Whole-house temperature cannot overwrite an in-flight room request.
 assert(!rooms.submit("ac_darren,ac_parents","ac_temp_delta","0.5",510));
 rooms.receive(ac("ac_parents",2,"27.0"),600);rooms.receive(ac("ac_darren",2,"25.5"),610);
 assert(rooms.submit("ac_darren,ac_parents","ac_temp_delta","0.5",620));
 assert(rooms.devices["ac_parents"].requested=="27.0"); // rounded mean 26.5 + .5
 assert(rooms.devices["ac_darren"].requested=="27.0");
 assert(rooms.submit("ac_parents,ac_darren","ac_temp_delta","0.5",630));
 assert(rooms.devices["ac_parents"].requested=="27.5");
 rooms.connection(false,640);assert(!rooms.next_command(2000,c));
 // Mixed ALL OFF uses explicit domain-specific commands, with no reset of target/fan.
 State house;house.connection(true,0);house.receive(ac("ac_living",1),0);house.receive(light("light_living_room",1,true,70),0);
 assert(house.submit("ac_living,light_living_room","all_off","off",10));
 assert(house.next_command(20,c));assert(c.key=="ac_living" && c.action=="ac_power" && c.value=="off");
 assert(house.next_command(30,c));assert(c.key=="light_living_room" && c.action=="light_power" && c.value=="off");
 // Drag locks both individual and overlapping group commands, but not unrelated rooms.
 State drag;drag.connection(true,0);drag.receive(light("light_da_head",1),0);drag.receive(light("light_am_door",1),0);
 drag.start_drag("light_da_head",100);
 assert(!drag.can_submit("light_da_head,light_da_foot",110));
 assert(drag.can_submit("light_am_door",110));
 assert(drag.summary("light_da_head,light_da_foot",110).dragging);
 drag.end_drag("light_da_head");assert(drag.submit("light_da_head","light_brightness","75",120));
 drag.connection(false,200);drag.connection(true,300);
 assert(!drag.can_submit("light_da_head",300));
 State stale;stale.connection(true,0);stale.receive(light("light_am_door",1),0);
 assert(!stale.submit("light_am_door","light_power","on",75000));
 std::cout<<"Group scenarios passed: partial availability/confirmation/timeout, no late replay, CSV normalization, overlapping commands, independent debounce, house temperature, ALL OFF, drag locks, reconnect, freshness.\n";
}
