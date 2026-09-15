#pragma once
#include "ui_state.h"
#include <lvgl.h>
#include <initializer_list>

namespace tab5_v4 {
inline void disabled(lv_obj_t *obj,bool value) {
  if(value) lv_obj_add_state(obj,LV_STATE_DISABLED);else lv_obj_clear_state(obj,LV_STATE_DISABLED);
}
inline void text(lv_obj_t *obj,const std::string &value) {
  if(value!=lv_label_get_text(obj)) lv_label_set_text(obj,value.c_str());
}
inline void check(lv_obj_t *obj,bool value) {
  if(value) lv_obj_add_state(obj,LV_STATE_CHECKED);else lv_obj_clear_state(obj,LV_STATE_CHECKED);
}
inline void light_feedback(State &s,const std::string &csv,lv_obj_t *sw,lv_obj_t *slider,
                           lv_obj_t *label,std::initializer_list<lv_obj_t*> buttons,
                           uint32_t now,uint32_t muted,uint32_t waiting) {
  if(csv.empty()) {text(label,"");return;}
  const auto sum=s.summary(csv,now);
  const bool can=s.can_submit(csv,now);
  disabled(sw,!can);
  // Keep an ongoing drag active until release; other overlapping controls are locked.
  disabled(slider,(!(sum.dragging && s.drag_owner==canonical(csv)) && !can) || !sum.ready);
  for(auto *button:buttons) disabled(button,!can);
  text(label,s.group_status(csv,now));
  lv_obj_set_style_text_color(label,lv_color_hex(sum.pending?waiting:muted),LV_PART_MAIN);
  if(sum.ready && !sum.dragging) {
    check(sw,sum.on>0);
    if(lv_slider_get_value(slider)!=sum.brightness())
      lv_slider_set_value(slider,sum.brightness(),LV_ANIM_OFF);
  }
}
inline void ac_feedback(State &s,const std::string &csv,lv_obj_t *target,lv_obj_t *label,
                        lv_obj_t *plus,lv_obj_t *minus,lv_obj_t *automatic,lv_obj_t *quiet,lv_obj_t *power,
                        lv_obj_t *power_icon,uint32_t now,uint32_t muted,uint32_t waiting,uint32_t accent) {
  const auto sum=s.summary(csv,now);
  const bool temp_ready=s.can_submit(csv,now,true) && sum.target_count>0;
  disabled(plus,!temp_ready);disabled(minus,!temp_ready);
  for(auto *button:{automatic,quiet,power}) disabled(button,!s.can_submit(csv,now));
  text(label,s.group_status(csv,now));
  lv_obj_set_style_text_color(label,lv_color_hex(sum.pending?waiting:muted),LV_PART_MAIN);
  lv_obj_set_style_text_color(power_icon,lv_color_hex(sum.pending?waiting:sum.on?accent:muted),LV_PART_MAIN);
  if(sum.target_count) {
    char buf[24];snprintf(buf,sizeof(buf),"%.1f °C",sum.target());text(target,buf);
  } else text(target,"-- °C");
}
} // namespace tab5_v4
