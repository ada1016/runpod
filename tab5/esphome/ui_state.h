#pragma once
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <cstdio>
#include <map>
#include <set>
#include <string>
#include <vector>

namespace tab5_v4 {
inline std::vector<std::string> split(const std::string &s) {
  std::vector<std::string> f;
  size_t start=0;
  do {
    auto p=s.find('|',start);
    f.push_back(s.substr(start,p==std::string::npos?p:p-start));
    if(p==std::string::npos) break;
    start=p+1;
  } while(true);
  return f;
}
inline bool number(const std::string &s, float &v) {
  char *end=nullptr; v=strtof(s.c_str(), &end);
  return end!=s.c_str() && *end=='\0' && std::isfinite(v);
}
inline std::vector<std::string> keys(const std::string &csv) {
  auto text=csv; std::replace(text.begin(),text.end(),',','|');
  std::set<std::string> unique;
  for(auto key:split(text)) {
    const auto a=key.find_first_not_of(" ");
    if(a!=std::string::npos) unique.insert(key.substr(a,key.find_last_not_of(" ")-a+1));
  }
  return {unique.begin(),unique.end()};
}
inline std::string canonical(const std::string &csv) {
  std::string out; for(const auto &k:keys(csv)) {if(!out.empty()) out+=",";out+=k;}return out;
}
inline const std::string ALL_AC="ac_living,ac_parents,ac_darren,ac_amber";
inline const std::string ALL_LIGHTS="light_living_room,light_bedroom_window,light_da_head,light_da_foot,light_da_desk,light_am_door,light_am_foot,light_am_desk";
struct Operation {
  std::map<std::string,uint64_t> tickets;
  uint32_t completed_at=0;
  bool complete=false;
};
struct Summary {
  int total=0,ready=0,on=0,pending=0,brightness_count=0,target_count=0;
  float brightness_sum=0,target_sum=0;
  bool dragging=false;
  int brightness() const {return brightness_count?int(std::round(brightness_sum/brightness_count)):0;}
  float target() const {return target_count?std::round(target_sum/target_count*2)/2:NAN;}
};
struct Command {std::string key,action,value;};
struct Device {
  std::vector<std::string> fields;
  std::string session, action, requested, result, owner;
  uint64_t ticket=0;
  uint64_t sequence=0;
  uint32_t received=0, started=0, result_at=0;
  bool seen=false, pending=false, sent=false;
};
class State {
 public:
  std::map<std::string,Device> devices;
  bool online=false;
  std::map<std::string,uint32_t> drags;
  std::string drag_owner;
  std::map<std::string,Operation> operations;
  static constexpr uint32_t STALE_MS=75000, TIMEOUT_MS=12000;
  bool receive(const std::string &packet, uint32_t now) {
    auto f=split(packet);
    if(f.size()<8 || f[0]!="3" || f[1]!="D") return false;
    const size_t expected=f[3]=="climate"?11:f[3]=="light"?10:f[3]=="sensor"?8:0;
    if(f.size()!=expected) return false;
    const size_t ai=f[3]=="climate"?8:f[3]=="light"?6:5;
    if(f[ai]!="0" && f[ai]!="1") return false;
    if(f[3]=="light" && f[4]!="0" && f[4]!="1") return false;
    auto &d=devices[f[2]];
    const auto &session=f[f.size()-2];
    char *end=nullptr;
    const auto seq=strtoull(f.back().c_str(),&end,10);
    if(f.back().empty() || *end!='\0' || session.empty()) return false;
    if(d.seen && d.session==session && seq<=d.sequence) return false;
    if(d.seen && d.session!=session && d.pending) {
      finish(d,"Bridge restarted; check device",now);
    }
    d.fields=f; d.session=session; d.sequence=seq; d.received=now; d.seen=true;
    if(d.pending && d.sent && available(d) && matches(d)) finish(d,"Confirmed by HA",now);
    return true;
  }
  bool available(const Device &d) const {
    if(!d.seen) return false;
    return d.fields[d.fields[3]=="climate"?8:d.fields[3]=="light"?6:5]=="1";
  }
  bool ready(const std::string &key,uint32_t now) {
    auto &d=devices[key];
    return online && d.seen && uint32_t(now-d.received)<STALE_MS && available(d);
  }
  bool begin(const std::string &key,const std::string &action,const std::string &value,uint32_t now) {
    auto &d=devices[key];
    if(!ready(key,now)) return false;
    // Only temperature can replace an in-flight intent. Other actions are serialized.
    if(d.pending && !(action=="ac_set_temperature" && d.action==action)) return false;
    d.ticket++; d.action=action; d.requested=value; d.started=now; d.pending=true; d.sent=false; d.result.clear();
    return true;
  }
  std::string temperature_delta(const std::string &key,float delta,uint32_t now) {
    auto &d=devices[key]; float value;
    if(!ready(key,now) || d.fields[3]!="climate" ||
       (d.pending && d.action!="ac_set_temperature")) return "";
    if(!number(d.pending?d.requested:d.fields[6],value)) return "";
    value=std::max(18.0f,std::min(30.0f,value+delta));
    char buf[16]; snprintf(buf,sizeof(buf),"%.1f",value);
    return begin(key,"ac_set_temperature",buf,now)?buf:"";
  }
  void mark_sent(const std::string &key) {devices[key].sent=true;}
  void connection(bool connected,uint32_t now) {
    if(online && !connected) {
      for(auto &item:devices) {
        auto &d=item.second;
        if(d.pending) finish(d,"Disconnected; check device",now);
        d.seen=false;
      }
      drags.clear();drag_owner.clear();
    }
    online=connected;
  }
  void tick(uint32_t now) {
    for(auto &item:devices) {
      auto &d=item.second;
      if(d.pending && uint32_t(now-d.started)>=TIMEOUT_MS) finish(d,"No confirmation; check device",now);
    }
    for(auto it=drags.begin();it!=drags.end();) {
      if(uint32_t(now-it->second)>30000) it=drags.erase(it); else ++it;
    }
    if(drags.empty()) drag_owner.clear();
    for(auto &entry:operations) {
      auto &op=entry.second;
      if(!op.complete) {
        bool pending=false;
        for(const auto &item:op.tickets) {
          auto &d=devices[item.first];
          if(item.second && d.ticket==item.second && d.pending) pending=true;
        }
        if(!pending) {op.complete=true;op.completed_at=now;}
      }
    }
  }
  std::string status(const std::string &key,uint32_t now) {
    auto &d=devices[key];
    if(!online) return "Disconnected";
    if(!d.seen) return "Syncing...";
    if(uint32_t(now-d.received)>=STALE_MS) return "Stale - waiting for bridge";
    if(!available(d)) return "Unavailable in HA";
    if(d.pending) return "Waiting for HA...";
    if(!d.result.empty() && uint32_t(now-d.result_at)<8000) return d.result;
    return "HA state current";
  }

  void start_drag(const std::string &csv,uint32_t now) {
    drags.clear();drag_owner=canonical(csv);
    for(const auto &key:keys(csv)) drags[key]=now;
  }
  void end_drag(const std::string &csv) {for(const auto &key:keys(csv)) drags.erase(key);if(drags.empty()) drag_owner.clear();}
  Summary summary(const std::string &csv,uint32_t now) {
    Summary out;
    for(const auto &key:keys(csv)) {
      auto &d=devices[key];out.total++;
      out.pending+=d.pending;
      out.dragging|=drags.count(key)>0;
      if(!ready(key,now)) continue;
      out.ready++;
      if(d.fields[3]=="climate") {
        bool on=d.fields[4]!="off";
        if(d.pending && d.action=="ac_power") on=d.requested=="on";
        out.on+=on;
        float target;
        if(number(d.pending && d.action=="ac_set_temperature"?d.requested:d.fields[6],target)) {
          out.target_sum+=target;out.target_count++;
        }
      } else if(d.fields[3]=="light") {
        bool on=d.fields[4]=="1";float brightness=0;
        number(d.fields[5],brightness);
        if(d.pending && d.action=="light_power") on=d.requested=="on";
        if(d.pending && d.action=="light_brightness") {number(d.requested,brightness);on=brightness>0;}
        if(d.pending && d.action=="light_cct") on=true;
        out.on+=on;out.brightness_sum+=brightness;out.brightness_count++;
      }
    }
    return out;
  }
  bool can_submit(const std::string &csv,uint32_t now,bool temperature=false) {
    auto list=keys(csv);bool any=false;const auto owner=canonical(csv);
    for(const auto &key:list) {
      auto &d=devices[key];
      if(drags.count(key)) return false;
      if(d.pending && !(temperature && d.action=="ac_set_temperature" && d.owner==owner)) return false;
      any|=ready(key,now);
    }
    return any;
  }
  bool submit(const std::string &csv,std::string action,std::string value,uint32_t now) {
    const bool temperature=action=="ac_temp_delta" || action=="ac_set_temperature";
    if(!can_submit(csv,now,temperature)) return false;
    const auto owner=canonical(csv);
    auto sum=summary(csv,now);
    if(action=="ac_temp_delta") {
      float delta;if(!number(value,delta) || !sum.target_count) return false;
      char buf[16];snprintf(buf,sizeof(buf),"%.1f",std::max(18.0f,std::min(30.0f,sum.target()+delta)));
      action="ac_set_temperature";value=buf;
    }
    if(action=="ac_power_toggle" || action=="light_group_toggle") {
      action=action=="ac_power_toggle"?"ac_power":"light_power";
      value=sum.on?"off":"on";
    }
    Operation op;
    for(const auto &key:keys(csv)) {
      auto &d=devices[key];
      const std::string resolved=action=="all_off"?(key.rfind("ac_",0)==0?"ac_power":"light_power"):action;
      if(!ready(key,now)) {op.tickets[key]=0;continue;}
      if(begin(key,resolved,action=="all_off"?"off":value,now)) {
        d.owner=owner;op.tickets[key]=d.ticket;
      } else op.tickets[key]=0;
    }
    operations[owner]=op;
    return true;
  }
  // Dispatch at most one explicit device intent per call. Each AC has its own debounce.
  bool next_command(uint32_t now,Command &out) {
    for(auto &item:devices) {
      auto &d=item.second;
      if(!d.pending || d.sent) continue;
      if(!ready(item.first,now)) {finish(d,"Unavailable; check device",now);continue;}
      if(d.action=="ac_set_temperature" && uint32_t(now-d.started)<350) continue;
      d.sent=true;d.started=now;out={item.first,d.action,d.requested};return true;
    }
    return false;
  }
  std::string group_status(const std::string &csv,uint32_t now) {
    if(!online) return "Disconnected";
    const auto list=keys(csv);if(list.empty()) return "";
    if(list.size()==1) return status(list[0],now);
    const auto sum=summary(csv,now);
    auto it=operations.find(canonical(csv));
    if(it!=operations.end() && (!it->second.complete || uint32_t(now-it->second.completed_at)<8000)) {
      int ok=0,pending=0,skipped=0,failed=0;
      for(const auto &item:it->second.tickets) {
        auto &d=devices[item.first];
        if(!item.second) skipped++;
        else if(d.ticket!=item.second) failed++;
        else if(d.pending) pending++;
        else if(d.result=="Confirmed by HA") ok++;
        else failed++;
      }
      const std::string count=std::to_string(ok)+"/"+std::to_string(list.size());
      if(pending) return count+" confirmed; waiting";
      if(failed) return count+" confirmed; check rest";
      if(skipped) return count+" confirmed; "+std::to_string(skipped)+" skipped";
      return "All "+std::to_string(ok)+" confirmed by HA";
    }
    if(sum.pending) return std::to_string(sum.pending)+" device(s) pending";
    if(sum.ready!=sum.total) return std::to_string(sum.ready)+"/"+std::to_string(sum.total)+" ready; rest skipped";
    return std::to_string(sum.ready)+"/"+std::to_string(sum.total)+" HA states current";
  }
 private:
  void finish(Device &d,const std::string &result,uint32_t now) {
    d.pending=false; d.sent=false; d.result=result; d.result_at=now;
  }
  bool matches(const Device &d) const {
    const auto &f=d.fields;
    if(d.action=="ac_power") return d.requested=="off" ? f[4]=="off" : f[4]=="cool";
    if(d.action=="ac_fan_auto") return f[5]=="Auto";
    if(d.action=="ac_fan_quiet") return f[5]=="Quiet";
    if(d.action=="light_power") return f[4]==(d.requested=="on"?"1":"0");
    float desired,actual;
    if(!number(d.requested,desired)) return false;
    if(d.action=="ac_set_temperature") return number(f[6],actual) && std::fabs(actual-desired)<0.1f;
    if(d.action=="light_brightness") return number(f[5],actual) &&
      (desired==0 ? f[4]=="0" : f[4]=="1" && std::fabs(actual-desired)<=1.0f);
    if(d.action=="light_cct") return f[4]=="1" && number(f[7],actual) && std::fabs(actual-desired)<=100.0f;
    return false;
  }
};
inline State &state() { static State instance; return instance; }
}  // namespace tab5_v4
