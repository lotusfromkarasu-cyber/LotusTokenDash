use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all="lowercase")]
pub enum Edge { #[default] Top, Bottom, Left, Right }
impl Edge { pub fn vertical(self)->bool {matches!(self,Self::Left|Self::Right)} }
#[derive(Clone, Copy, Debug)]
pub struct Rect { pub x:i32, pub y:i32, pub width:i32, pub height:i32 }

pub fn size(strip:bool, expanded:bool, edge:Edge)->(f64,f64) {
    if strip&&!expanded {if edge.vertical(){(32.0,142.0)}else{(324.0,20.0)}}
    else {(324.0,if expanded{176.0}else{142.0})}
}
pub fn nearest(window:Rect, screen:Rect, threshold:i32)->Option<Edge> {
    [(Edge::Top,(window.y-screen.y).abs()),
     (Edge::Bottom,(window.y+window.height-screen.y-screen.height).abs()),
     (Edge::Left,(window.x-screen.x).abs()),
     (Edge::Right,(window.x+window.width-screen.x-screen.width).abs())]
        .into_iter().filter(|(_,distance)|*distance<=threshold).min_by_key(|(_,distance)|*distance).map(|(edge,_)|edge)
}
pub fn anchor(old:Rect, screen:Rect, width:i32, height:i32, edge:Edge, inset:i32)->(i32,i32) {
    let (x,y)=match edge {
        Edge::Top=>(old.x+(old.width-width)/2,screen.y+inset),
        Edge::Bottom=>(old.x+(old.width-width)/2,screen.y+screen.height-height-inset),
        Edge::Left=>(screen.x+inset,old.y+(old.height-height)/2),
        Edge::Right=>(screen.x+screen.width-width-inset,old.y+(old.height-height)/2),
    };
    (x.clamp(screen.x,screen.x+(screen.width-width).max(0)),
     y.clamp(screen.y,screen.y+(screen.height-height).max(0)))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn detects_every_edge_on_negative_origin_monitor(){
        let screen=Rect{x:-1920,y:-200,width:1920,height:1080};
        for (edge,x,y) in [(Edge::Top,-900,-195),(Edge::Bottom,-900,735),(Edge::Left,-1915,200),(Edge::Right,-329,200)] {
            assert_eq!(nearest(Rect{x,y,width:324,height:142},screen,28),Some(edge));
        }
        assert_eq!(nearest(Rect{x:-900,y:200,width:324,height:142},screen,28),None);
    }
    #[test]
    fn expand_and_scale_keep_edge_and_old_hover_area_inside(){
        let screen=Rect{x:0,y:0,width:1920,height:1040};
        for edge in [Edge::Top,Edge::Bottom,Edge::Left,Edge::Right] {
            for scale in [0.75,1.0,1.5] {
                let (w,h)=size(true,false,edge);let (ew,eh)=size(true,true,edge);
                let (w,h,ew,eh)=((w*scale)as i32,(h*scale)as i32,(ew*scale)as i32,(eh*scale)as i32);
                let center=Rect{x:800,y:400,width:w,height:h};
                let (x,y)=anchor(center,screen,w,h,edge,0);let collapsed=Rect{x,y,width:w,height:h};
                let (ex,ey)=anchor(collapsed,screen,ew,eh,edge,0);
                assert!(ex<=x && ey<=y && ex+ew>=x+w && ey+eh>=y+h);
                assert!(ex>=0 && ey>=0 && ex+ew<=1920 && ey+eh<=1040);
                let (cx,cy)=anchor(Rect{x:ex,y:ey,width:ew,height:eh},screen,w,h,edge,0);
                assert!((cx-x).abs()<=1 && (cy-y).abs()<=1);
            }
        }
    }
    #[test]
    fn corners_are_clamped_and_floating_release_moves_inward(){
        let screen=Rect{x:0,y:0,width:1920,height:1040};
        assert_eq!(anchor(Rect{x:1900,y:1020,width:20,height:20},screen,324,176,Edge::Bottom,0),(1596,864));
        assert_eq!(anchor(screen,screen,324,142,Edge::Right,48).0,1548);
    }
}
